/**
 * Git commit attribution — deterministic, code-level interception.
 *
 * Strategy: after a `git commit` Bash tool call completes, immediately amend
 * the last commit to append the Co-Authored-By trailer. This happens before
 * the LLM gets the tool result back, so it cannot be skipped or overridden.
 *
 * Mirrors what Claude Code and Amp do, but enforced in the event pipeline
 * rather than relying on the system prompt.
 */

/** Co-Authored-By trailer injected into every dough-created commit. */
export const ATTRIBUTION_TRAILER =
  "Co-Authored-By: Dough Agent <noreply@try-dough.com>";

/**
 * Returns true if a Bash command string is a `git commit` invocation.
 * Handles common forms:
 *   git commit -m "..."
 *   git commit --amend
 *   GIT_AUTHOR_NAME=x git commit ...
 */
export function isGitCommitCommand(command: string): boolean {
  // Match `git commit` anywhere in the command (handles env-var prefixes, etc.)
  return /\bgit\s+commit\b/.test(command);
}

/**
 * Amends the most recent commit in `cwd` to append the Dough attribution
 * trailer if it is not already present.
 *
 * Called immediately after the agent's `git commit` tool call completes, so
 * the staging area is guaranteed empty and HEAD is the commit we just made.
 * Uses `--no-edit` to preserve the message and `-C HEAD` to stay on the
 * same tree — only the trailer is added.
 */
export async function appendAttributionTrailer(cwd: string): Promise<void> {
  try {
    // Read the current HEAD message to avoid duplicating the trailer.
    const headMsg = await Bun.$`git -C ${cwd} log -1 --pretty=%B`
      .quiet()
      .text();

    if (headMsg.includes(ATTRIBUTION_TRAILER)) return;

    // Amend with the trailer. Bun's shell escapes template literals so the
    // full "Co-Authored-By: ..." string is passed as a single argument.
    await Bun.$`git -C ${cwd} commit --amend --no-edit --trailer ${ATTRIBUTION_TRAILER}`.quiet();

    console.log("[dough] git attribution trailer appended to commit");
  } catch (err) {
    // Non-fatal: not a git repo, empty repo, read-only FS, etc.
    console.warn(
      "[dough] could not append git attribution trailer:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
