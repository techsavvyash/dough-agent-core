import { DoughEventType } from "@dough/protocol";
import type { DoughEvent } from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions } from "./provider.ts";

/**
 * Codex provider using @openai/codex-sdk.
 *
 * Wraps the Codex SDK:
 * - new Codex() → codex.startThread() / codex.resumeThread(id)
 * - thread.runStreamed(input) → { events: AsyncIterable<Event> }
 * - JSONL persistence in ~/.codex/sessions
 *
 * TODO: Implement once dependencies are installed.
 */
export class CodexProvider implements LLMProvider {
  readonly name = "codex";
  readonly maxContextTokens = 200_000;

  constructor(
    private options: {
      model?: string;
      env?: Record<string, string>;
    } = {}
  ) {}

  async *send(
    messages: ThreadMessage[],
    options: SendOptions
  ): AsyncGenerator<DoughEvent> {
    // TODO: Implement using codex-sdk
    // const codex = new Codex({ env: this.options.env });
    // const thread = codex.startThread();
    // const { events } = await thread.runStreamed(prompt);
    // for await (const event of events) {
    //   yield mapToDoughEvent(event);
    // }

    const stubText = "[Codex provider not yet connected]";
    const streamId = crypto.randomUUID();
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    yield {
      type: DoughEventType.ContentDelta,
      text: stubText,
      streamId,
    };

    yield {
      type: DoughEventType.ContentComplete,
      text: stubText,
      usage,
      streamId,
    };

    yield {
      type: DoughEventType.Finished,
      reason: "completed",
      usage,
    };
  }

  async estimateTokens(messages: ThreadMessage[]): Promise<number> {
    return messages.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0
    );
  }

  async createSession(options?: {
    sessionId?: string;
    model?: string;
  }): Promise<string> {
    // TODO: Use codex.startThread() / codex.resumeThread()
    return crypto.randomUUID();
  }
}
