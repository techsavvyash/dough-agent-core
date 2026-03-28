import { DoughEventType } from "@dough/protocol";
import type { Attachment, DoughEvent } from "@dough/protocol";
import type { ThreadManager, ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions, ToolMiddleware } from "./providers/provider.ts";
import type { PlatformRuntime } from "./runtime/runtime.ts";
import { createToolCallEvent, createToolResultEvent } from "./runtime/events.ts";

export interface DoughSessionConfig {
  provider: LLMProvider;
  threadManager: ThreadManager;
  systemPrompt?: string;
  model?: string;
  /**
   * Provider-agnostic tool middleware applied before every tool execution.
   * Configured once on DoughAgent and propagated to all sessions automatically.
   */
  toolMiddleware?: ToolMiddleware[];
  /**
   * Optional platform runtime. When provided, session emits platform events
   * (turn:start, tool:call, tool:result, message:delta, turn:end) through
   * the runtime's event bus.
   */
  runtime?: PlatformRuntime;
}

/**
 * A single conversation session. Manages the agentic loop:
 * send → stream response → handle tool calls → continue.
 * Uses ThreadManager for context window cap enforcement.
 */
export class DoughSession {
  readonly id: string;
  private activeThreadId: string | null = null;
  private provider: LLMProvider;
  private threadManager: ThreadManager;
  private systemPrompt?: string;
  private model?: string;
  private toolMiddleware: ToolMiddleware[];
  private runtime: PlatformRuntime | null;
  private abortController: AbortController | null = null;

  constructor(id: string, config: DoughSessionConfig) {
    this.id = id;
    this.provider = config.provider;
    this.threadManager = config.threadManager;
    this.systemPrompt = config.systemPrompt;
    this.model = config.model;
    this.toolMiddleware = config.toolMiddleware ?? [];
    this.runtime = config.runtime ?? null;
  }

  get currentThreadId(): string | null {
    return this.activeThreadId;
  }

  async initialize(): Promise<string> {
    const thread = await this.threadManager.createThread(this.id);
    this.activeThreadId = thread.id;
    return thread.id;
  }

  /**
   * Resume from an existing thread instead of creating a new one.
   * Used when reconnecting to a previously-saved session.
   */
  resumeThread(threadId: string): void {
    this.activeThreadId = threadId;
  }

  async *send(prompt: string, attachments?: Attachment[]): AsyncGenerator<DoughEvent> {
    if (!this.activeThreadId) {
      await this.initialize();
    }

    this.abortController = new AbortController();
    const threadId = this.activeThreadId!;

    // Add user message
    const userMessage: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      tokenEstimate: Math.ceil(prompt.length / 4),
      timestamp: new Date().toISOString(),
    };
    await this.threadManager.addMessage(threadId, userMessage);

    // Re-fetch thread AFTER addMessage to get the updated token count
    const thread = await this.threadManager.getThread(threadId);
    if (!thread) throw new Error(`Active thread ${threadId} not found`);

    // Check if handoff is needed with fresh token count
    if (this.threadManager.needsHandoff(thread)) {
      const result = await this.threadManager.handoff(threadId);
      this.activeThreadId = result.toThread.id;

      yield {
        type: DoughEventType.ThreadHandoff,
        fromThreadId: result.fromThread.id,
        toThreadId: result.toThread.id,
        summary: result.summary,
      };
    }

    // Get current thread messages and send to provider
    const currentThread = await this.threadManager.getThread(
      this.activeThreadId!
    );
    if (!currentThread) throw new Error("Thread lost after handoff");

    const options: SendOptions = {
      model: this.model,
      systemPrompt: this.systemPrompt,
      signal: this.abortController.signal,
      toolMiddleware: this.toolMiddleware.length > 0 ? this.toolMiddleware : undefined,
      attachments: attachments?.length ? attachments : undefined,
    };

    // Emit turn:start platform event
    if (this.runtime) {
      await this.runtime.emit({
        type: "turn:start",
        sessionId: this.id,
        threadId: this.activeThreadId!,
      });
    }

    let fullResponse = "";
    // Collect tool calls so they can be persisted with the assistant message
    const toolCallMap = new Map<string, {
      name: string;
      args: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
    }>();

    for await (const event of this.provider.send(
      currentThread.messages,
      options
    )) {
      // Check abort before yielding each event
      if (this.abortController.signal.aborted) {
        yield { type: DoughEventType.Aborted };
        return;
      }

      if (event.type === DoughEventType.ContentDelta) {
        fullResponse += event.text;

        // Emit message:delta platform event
        if (this.runtime) {
          await this.runtime.emit({
            type: "message:delta",
            text: event.text,
            streamId: event.streamId,
          });
        }
      }

      if (event.type === DoughEventType.ToolCallRequest) {
        toolCallMap.set(event.callId, { name: event.name, args: event.args });

        // Emit tool:call platform event — extensions can veto or rewrite
        if (this.runtime) {
          const toolCallEvent = createToolCallEvent(event.callId, event.name, event.args);
          await this.runtime.emit(toolCallEvent);

          if (toolCallEvent.vetoed) {
            // Extension vetoed this tool call — skip it
            continue;
          }
          if (toolCallEvent.rewritten) {
            // Extension rewrote the args — update the event we yield
            (event as any).args = toolCallEvent.args;
            toolCallMap.set(event.callId, { name: event.name, args: toolCallEvent.args });
          }
        }
      }

      if (event.type === DoughEventType.ToolCallResponse) {
        const tc = toolCallMap.get(event.callId);
        if (tc) {
          toolCallMap.set(event.callId, { ...tc, result: event.result, isError: event.isError });
        }

        // Emit tool:result platform event — extensions can mutate
        if (this.runtime) {
          const toolResultEvent = createToolResultEvent(
            event.callId,
            tc?.name ?? "unknown",
            event.result,
            event.isError ?? false,
          );
          await this.runtime.emit(toolResultEvent);
        }
      }

      yield event;
    }

    // Final abort check after stream completes
    if (this.abortController.signal.aborted) {
      yield { type: DoughEventType.Aborted };
      return;
    }

    // Emit turn:end platform event
    if (this.runtime) {
      await this.runtime.emit({
        type: "turn:end",
        sessionId: this.id,
        threadId: this.activeThreadId!,
      });
    }

    // Store assistant response, including any tool calls that occurred this turn
    if (fullResponse || toolCallMap.size > 0) {
      const toolCalls = Array.from(toolCallMap.entries()).map(([callId, tc]) => ({
        callId,
        name: tc.name,
        args: tc.args,
        status: (tc.isError ? "error" : "success") as "success" | "error",
        output:
          typeof tc.result === "string"
            ? tc.result
            : tc.result != null
              ? JSON.stringify(tc.result, null, 2)
              : undefined,
      }));

      const assistantMessage: ThreadMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: fullResponse,
        tokenEstimate: Math.ceil(fullResponse.length / 4),
        timestamp: new Date().toISOString(),
        metadata: toolCalls.length > 0 ? { toolCalls } : undefined,
      };
      await this.threadManager.addMessage(this.activeThreadId!, assistantMessage);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
