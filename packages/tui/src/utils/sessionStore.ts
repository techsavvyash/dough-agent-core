import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const DOUGH_DIR = join(process.env.HOME ?? ".", ".dough");
const SESSION_FILE = join(DOUGH_DIR, ".last_session");

/** Read the last-used sessionId from ~/.dough/.last_session. Returns null if absent. */
export async function loadLastSessionId(): Promise<string | null> {
  try {
    const file = Bun.file(SESSION_FILE);
    if (!(await file.exists())) return null;
    const text = (await file.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Persist the current sessionId to ~/.dough/.last_session. */
export async function saveLastSessionId(sessionId: string): Promise<void> {
  try {
    await mkdir(DOUGH_DIR, { recursive: true });
    await Bun.write(SESSION_FILE, sessionId);
  } catch {
    // Non-fatal — session just won't resume next boot
  }
}
