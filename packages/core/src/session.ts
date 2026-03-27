import { DoughEventType } from "@dough/protocol";
import type { Attachment, DoughEvent } from "@dough/protocol";
import type { ThreadManager, ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions, ToolMiddleware } from "./providers/provider.ts";

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
  private abortController: AbortController | null = null;

  constructor(id: string, config: DoughSessionConfig) {
    this.id = id;
    this.provider = config.provider;
    this.threadManager = config.threadManager;
    this.systemPrompt = config.systemPrompt;
    this.model = config.model;
    this.toolMiddleware = config.toolMiddleware ?? [];
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

    let fullResponse = "";
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
      }

      yield event;
    }

    // Final abort check after stream completes
    if (this.abortController.signal.aborted) {
      yield { type: DoughEventType.Aborted };
      return;
    }

    // Store assistant response
    if (fullResponse) {
      const assistantMessage: ThreadMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: fullResponse,
        tokenEstimate: Math.ceil(fullResponse.length / 4),
        timestamp: new Date().toISOString(),
      };
      await this.threadManager.addMessage(this.activeThreadId!, assistantMessage);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
