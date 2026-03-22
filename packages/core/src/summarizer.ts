import { DoughEventType } from "@dough/protocol";
import type { ThreadMessage, SummaryGenerator } from "@dough/threads";
import type { LLMProvider } from "./providers/provider.ts";

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Given a conversation history, produce a concise summary that captures:
1. The user's goals and what they're working on
2. Key decisions made and their rationale
3. Current state of the work (what's done, what's in progress, what's next)
4. Any important context, file paths, variable names, or technical details that would be lost

Keep the summary under 2000 words. Focus on information the AI assistant would need to continue the conversation seamlessly. Write in third person ("The user...", "The assistant...").`;

/**
 * Summary generator that uses the LLM provider itself to create
 * intelligent summaries during thread handoff. Falls back to a
 * simple extraction if the LLM call fails.
 */
export class LLMSummaryGenerator implements SummaryGenerator {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async summarize(messages: ThreadMessage[]): Promise<string> {
    // Build a condensed transcript for the LLM
    const transcript = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");

    // Truncate if too long (leave room for system prompt)
    const maxChars = 100_000;
    const truncated =
      transcript.length > maxChars
        ? transcript.slice(-maxChars) // keep the most recent part
        : transcript;

    const summaryRequest: ThreadMessage[] = [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: `Summarize this conversation:\n\n${truncated}`,
        tokenEstimate: Math.ceil(truncated.length / 4),
        timestamp: new Date().toISOString(),
      },
    ];

    try {
      let summary = "";
      for await (const event of this.provider.send(summaryRequest, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
      })) {
        if (event.type === DoughEventType.ContentDelta) {
          summary += event.text;
        }
      }

      if (summary.trim()) return summary.trim();
    } catch {
      // LLM call failed, fall through to fallback
    }

    return this.fallbackSummarize(messages);
  }

  private fallbackSummarize(messages: ThreadMessage[]): string {
    const recent = messages.slice(-20);
    return recent
      .map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`)
      .join("\n\n");
  }
}
