/**
 * Git commit attribution — provider-agnostic, architecture-level enforcement.
 *
 * Design: attribution is a cross-cutting concern. It is configured once at
 * the DoughAgent level as a ToolMiddleware and flows down through DoughSession
 * → SendOptions → each provider's native hook adapter.
 *
 * Two-layer safety net:
 *
 * 1. PRIMARY — createAttributionMiddleware() → ToolMiddleware
 *    Provider-agnostic. Fires BEFORE the Bash tool executes (via the
 *    provider's native PreToolUse hook). Rewrites the git commit command to
 *    include `--trailer "Co-Authored-By: Dough Agent ..."` so attribution is
 *    baked in at commit-creation time, not patched after the fact.
 *
 * 2. FALLBACK — appendAttributionTrailer(cwd)
 *    Called by ws-handler after a ToolCallResponse. Handles edge cases where
 *    the pre-hook couldn't inject (e.g. --amend commits, SDK version gaps).
 */
import type { ToolMiddleware } from "./providers/provider.ts";

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
  return /\bgit\s+commit\b/.test(command);
}

/**
 * Returns a ToolMiddleware that intercepts `git commit` Bash calls and injects
 * the Dough attribution trailer BEFORE the command executes.
 *
 * This is provider-agnostic — it is configured on DoughAgent and translated
 * by each provider adapter into its native hook mechanism. Adding a new
 * provider never requires touching this function; only the adapter changes.
 *
 * Skips commands that:
 *   - Are not `git commit`
 *   - Are already `--amend` (would double-amend)
 *   - Already contain the attribution trailer
 */
export function createAttributionMiddleware(): ToolMiddleware {
  return {
    toolName: "Bash",
    async beforeToolUse(_toolName, input) {
      const command = (input.command as string | undefined) ?? "";

      if (
        !isGitCommitCommand(command) ||
        /--amend\b/.test(command) ||
        command.includes(ATTRIBUTION_TRAILER)
      ) {
        return; // pass through unchanged
      }

      console.log("[dough] injecting attribution trailer into git commit");
      return { ...input, command: `${command} --trailer "${ATTRIBUTION_TRAILER}"` };
    },
  };
}

/**
 * Amends the most recent commit in `cwd` to append the Dough attribution
 * trailer if it is not already present.
 *
 * FALLBACK ONLY. The primary mechanism is createAttributionMiddleware() which
 * fires before execution. This function handles residual edge cases:
 * - SDK versions that don't support PreToolUse hooks
 * - Codex / future providers before their hook adapter is implemented
 * - Any race condition where the hook fired but the amend was skipped
 */
export async function appendAttributionTrailer(cwd: string): Promise<void> {
  try {
    // Read the current HEAD message to avoid duplicating the trailer.
    const headMsg = await Bun.$`git -C ${cwd} log -1 --pretty=%B`
      .quiet()
      .text();

    if (headMsg.includes(ATTRIBUTION_TRAILER)) return;

    await Bun.$`git -C ${cwd} commit --amend --no-edit --trailer ${ATTRIBUTION_TRAILER}`.quiet();

    console.log("[dough] git attribution trailer appended to commit (fallback)");
  } catch (err) {
    // Non-fatal: not a git repo, empty repo, read-only FS, etc.
    console.warn(
      "[dough] could not append git attribution trailer:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
