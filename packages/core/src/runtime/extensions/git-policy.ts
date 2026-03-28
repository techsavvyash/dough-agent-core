/**
 * git-policy extension — enforces attribution on agent-created commits.
 *
 * Two-layer safety net:
 * 1. PRIMARY: intercepts `tool:call` for Bash tool, injects --trailer into
 *    git commit commands before they execute.
 * 2. FALLBACK: intercepts `tool:result` for Bash tool, amends the commit
 *    if the trailer is missing (handles edge cases like --amend, SDK gaps).
 *
 * Supplements the ToolMiddleware (createAttributionMiddleware) via runtime
 * events, providing a fallback amend layer for edge cases the middleware
 * cannot catch.
 */

import type { RuntimeExtension } from "../extension.ts";
import type { PlatformAPI } from "../api.ts";
import {
  ATTRIBUTION_TRAILER,
  isGitCommitCommand,
  appendAttributionTrailer,
} from "../../git-attribution.ts";

export interface GitPolicyConfig {
  /** Custom trailer string. Defaults to ATTRIBUTION_TRAILER. */
  trailer?: string;
  /** Override GIT_AUTHOR_NAME */
  authorName?: string;
  /** Override GIT_AUTHOR_EMAIL */
  authorEmail?: string;
  /** Inject -S signing flag */
  signingEnabled?: boolean;
}

export function createGitPolicyExtension(
  config?: GitPolicyConfig,
): RuntimeExtension {
  const trailer = config?.trailer ?? ATTRIBUTION_TRAILER;

  /**
   * Tracks in-flight Bash tool calls that contain git commit commands.
   * Keyed by callId → original command string.
   */
  const pendingGitCommits = new Map<string, string>();

  return {
    id: "git-policy",
    name: "Git Policy",
    kind: "policy",

    setup(api: PlatformAPI) {
      // ── PRIMARY: rewrite git commit commands to include --trailer ──
      api.on("tool:call", (event) => {
        if (event.toolName !== "Bash") return;

        const command = (event.args.command as string | undefined) ?? "";

        if (!isGitCommitCommand(command)) return;

        // Track this call for the fallback layer
        pendingGitCommits.set(event.callId, command);

        // Skip if already has trailer, or is --amend (would double-amend)
        if (/--amend\b/.test(command) || command.includes(trailer)) {
          return;
        }

        console.log("[git-policy] injecting attribution trailer into git commit");
        event.rewrite({
          ...event.args,
          command: `${command} --trailer "${trailer}"`,
        });
      });

      // ── FALLBACK: amend commit if trailer missing after execution ──
      api.on("tool:result", async (event) => {
        if (event.isError) return;

        const bashCmd = pendingGitCommits.get(event.callId);
        if (bashCmd === undefined) return;
        pendingGitCommits.delete(event.callId);

        // Skip --amend commands (avoid double-amending the primary hook's work)
        if (/--amend\b/.test(bashCmd)) return;

        await appendAttributionTrailer(api.cwd);
      });

      // ── Command: show current attribution config ──
      api.registerCommand({
        id: "git.attribution_info",
        name: "/git attribution",
        description: "Show current git attribution config",
        category: "git",
        execute() {
          const parts = [`Trailer: ${trailer}`];
          if (config?.authorName) parts.push(`Author name: ${config.authorName}`);
          if (config?.authorEmail) parts.push(`Author email: ${config.authorEmail}`);
          if (config?.signingEnabled) parts.push("Signing: enabled (-S)");
          api.notify(parts.join("\n"), "info");
        },
      });
    },
  };
}
