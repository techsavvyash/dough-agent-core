/**
 * session-commands extension — provides session and thread management
 * commands, shortcuts, and panels.
 *
 * Provides slash commands, keyboard shortcuts, and panels to the TUI
 * via runtime contributions. Command handlers emit UI intents (notify,
 * openPanel) that the server relays to the TUI over the wire protocol.
 */

import type { RuntimeExtension } from "../extension.ts";
import type { PlatformAPI } from "../api.ts";

export function createSessionCommandsExtension(): RuntimeExtension {
  return {
    id: "session-commands",
    name: "Session Commands",
    kind: "both",

    setup(api: PlatformAPI) {
      // ── Commands ──────────────────────────────────────────────

      api.registerCommand({
        id: "session.thread_info",
        name: "/thread info",
        description: "Show current thread details",
        category: "thread",
        execute() {
          const threadId = api.activeThreadId ?? "unknown";
          const sessionId = api.sessionId ?? "unknown";
          api.notify(
            `Thread: ${threadId}\nSession: ${sessionId}`,
            "info",
          );
        },
      });

      api.registerCommand({
        id: "session.thread_list",
        name: "/thread list",
        description: "View thread tree (Ctrl+T)",
        category: "thread",
        execute() {
          api.openPanel("threads.panel");
        },
      });

      api.registerCommand({
        id: "session.thread_fork",
        name: "/thread fork",
        description: "Fork current thread into a new branch",
        category: "thread",
        execute() {
          if (!api.activeThreadId) {
            api.notify("No active thread to fork.", "warning");
            return;
          }
          // The actual fork is handled by the server when it receives
          // the ui:command event — this just signals intent.
          api.notify("Forking current thread...", "info");
        },
      });

      api.registerCommand({
        id: "session.thread_new",
        name: "/thread new",
        description: "Start a fresh thread (old threads preserved)",
        category: "thread",
        execute() {
          api.notify("__clear__", "info");
          api.notify("Starting new thread...", "info");
        },
      });

      api.registerCommand({
        id: "session.clear",
        name: "/clear",
        description: "Clear the chat display",
        category: "session",
        execute() {
          // Clear is a UI-only action — the TUI handles it when it
          // sees this command executed.
          api.notify("__clear__", "info");
        },
      });

      api.registerCommand({
        id: "session.compact",
        name: "/compact",
        description: "Summarize and handoff to fresh thread",
        category: "session",
        execute() {
          api.notify("Compacting: summarizing context and handing off to new thread...", "info");
        },
      });

      api.registerCommand({
        id: "session.exit",
        name: "/exit",
        description: "Exit Dough",
        category: "session",
        execute() {
          process.exit(0);
        },
      });

      // ── Shortcuts ─────────────────────────────────────────────

      api.registerShortcut({
        id: "threads.shortcut",
        key: "ctrl+t",
        description: "Open thread viewer",
        commandId: "session.thread_list",
      });

      api.registerShortcut({
        id: "bash.shortcut",
        key: "ctrl+o",
        description: "Open bash output viewer",
        commandId: "session.bash_output",
      });

      // ── Bash output command (for Ctrl+O) ──
      api.registerCommand({
        id: "session.bash_output",
        name: "/bash output",
        description: "View bash tool output (Ctrl+O)",
        category: "session",
        execute() {
          api.openPanel("bash.panel");
        },
      });

      // ── Panels ────────────────────────────────────────────────

      api.registerPanel({
        id: "threads.panel",
        name: "Thread Viewer",
        mode: "overlay",
      });

      api.registerPanel({
        id: "bash.panel",
        name: "Bash Output",
        mode: "overlay",
      });
    },
  };
}
