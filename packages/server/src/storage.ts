import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HybridThreadStore } from "@dough/threads";

/**
 * Returns the ~/.dough directory path, creating it if it doesn't exist.
 *
 * Layout:
 *   ~/.dough/
 *     dough.db          — SQLite: thread metadata, indexed by session_id
 *     threads/
 *       <threadId>.jsonl — message blobs, one message per line (never deleted)
 */
export async function getDoughDir(): Promise<string> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const dir = join(home, ".dough");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Initialise the persistent HybridThreadStore rooted at ~/.dough.
 * Safe to call multiple times — mkdir and SQLite migrations are idempotent.
 */
export async function initDoughStorage(): Promise<HybridThreadStore> {
  const doughDir = await getDoughDir();
  const threadsDir = join(doughDir, "threads");
  const dbPath = join(doughDir, "dough.db");

  // threadsDir is created by HybridThreadStore on first write, but create it
  // eagerly so the directory is always visible on disk after startup.
  await mkdir(threadsDir, { recursive: true });

  console.log(`[storage] ~/.dough/dough.db — thread metadata`);
  console.log(`[storage] ~/.dough/threads/ — message blobs`);

  return new HybridThreadStore({ dbPath, threadsDir });
}
