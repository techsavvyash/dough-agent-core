import type { Thread, ThreadStore } from "../types.ts";

/**
 * JSONL file-backed thread store.
 * Compatible with claude-agent-sdk and codex-sdk session file patterns.
 * Each thread is stored as a separate .jsonl file in the configured directory.
 */
export class JsonlThreadStore implements ThreadStore {
  private dir: string;

  constructor(dir: string = ".dough/threads") {
    this.dir = dir;
  }

  private threadPath(threadId: string): string {
    return `${this.dir}/${threadId}.jsonl`;
  }

  async save(thread: Thread): Promise<void> {
    const path = this.threadPath(thread.id);

    // Ensure directory exists
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.dir, { recursive: true }).catch(() => {});

    const file = Bun.file(path);
    const lines = thread.messages
      .map((msg) => JSON.stringify(msg))
      .join("\n");

    // Write metadata as first line, then messages
    const metadata = JSON.stringify({
      _meta: true,
      id: thread.id,
      sessionId: thread.sessionId,
      parentThreadId: thread.parentThreadId,
      status: thread.status,
      tokenCount: thread.tokenCount,
      maxTokens: thread.maxTokens,
      summary: thread.summary,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    });

    await Bun.write(file, metadata + "\n" + lines + "\n");
  }

  async load(threadId: string): Promise<Thread | null> {
    const file = Bun.file(this.threadPath(threadId));
    if (!(await file.exists())) return null;

    const content = await file.text();
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    const meta = JSON.parse(lines[0]!) as Record<string, unknown>;
    const messages = lines.slice(1).map((line) => JSON.parse(line));

    return {
      id: meta.id as string,
      sessionId: meta.sessionId as string,
      parentThreadId: meta.parentThreadId as string | undefined,
      status: meta.status as Thread["status"],
      tokenCount: meta.tokenCount as number,
      maxTokens: meta.maxTokens as number,
      summary: meta.summary as string | undefined,
      messages,
      createdAt: meta.createdAt as string,
      updatedAt: meta.updatedAt as string,
    };
  }

  async list(sessionId: string): Promise<Thread[]> {
    const glob = new Bun.Glob("*.jsonl");
    const threads: Thread[] = [];

    for await (const path of glob.scan(this.dir)) {
      const threadId = path.replace(".jsonl", "");
      const thread = await this.load(threadId);
      if (thread && thread.sessionId === sessionId) {
        threads.push(thread);
      }
    }

    return threads.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async delete(threadId: string): Promise<void> {
    const file = Bun.file(this.threadPath(threadId));
    if (await file.exists()) {
      await Bun.write(file, ""); // Clear file
      // Note: Bun doesn't have a direct unlink on Bun.file,
      // use node:fs for actual deletion if needed
      const { unlink } = await import("node:fs/promises");
      await unlink(this.threadPath(threadId)).catch(() => {});
    }
  }
}
