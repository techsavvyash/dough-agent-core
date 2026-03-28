/**
 * PlatformAPI — the interface extensions receive during setup.
 *
 * Each extension gets its own scoped API instance so the runtime
 * can track which extension registered which contribution.
 */

import type { PlatformEventType } from "./events.ts";
import type { PlatformEventHandler } from "./event-bus.ts";
import type {
  RuntimeCommand,
  RuntimeShortcut,
  RuntimePanel,
  RuntimeTool,
} from "./types.ts";

export interface PlatformAPI {
  // ── Events ──────────────────────────────────────────────────

  /** Subscribe to a platform event. Returns an unsubscribe function. */
  on<T extends PlatformEventType>(
    type: T,
    handler: PlatformEventHandler<T>,
  ): () => void;

  // ── Registrations ───────────────────────────────────────────

  registerTool(tool: RuntimeTool): void;
  registerCommand(command: RuntimeCommand): void;
  registerShortcut(shortcut: RuntimeShortcut): void;
  registerPanel(panel: RuntimePanel): void;

  // ── UI intents ──────────────────────────────────────────────

  /** Queue a notification to be flushed to the host. */
  notify(message: string, level?: "info" | "warning" | "error"): void;
  /** Set a status bar entry. Pass undefined value to clear. */
  setStatus(key: string, value?: string): void;
  /** Request the host to open a registered panel. */
  openPanel(panelId: string, data?: unknown): void;

  // ── Session state ───────────────────────────────────────────

  /** Get extension-scoped session state. */
  getSessionState<T>(namespace: string): T | undefined;
  /** Set extension-scoped session state. */
  setSessionState<T>(namespace: string, value: T): void;

  // ── Read-only accessors ─────────────────────────────────────

  readonly cwd: string;
  readonly sessionId: string | null;
  readonly activeThreadId: string | null;
}
