// ── Runtime ─────────────────────────────────────────────────────
export { PlatformRuntime } from "./runtime.ts";
export type { PlatformRuntimeConfig, Notification, PanelOpenIntent } from "./runtime.ts";

// ── Event system ────────────────────────────────────────────────
export { EventBus } from "./event-bus.ts";
export type { PlatformEventHandler, ErrorHandler } from "./event-bus.ts";

export {
  createToolCallEvent,
  createToolResultEvent,
  createSessionBeforeCompactEvent,
} from "./events.ts";
export type {
  PlatformEvent,
  PlatformEventType,
  PlatformEventOfType,
  SessionStartEvent,
  SessionResumeEvent,
  SessionForkEvent,
  SessionBeforeCompactEvent,
  TurnStartEvent,
  TurnEndEvent,
  InputReceivedEvent,
  ClientBeforeRunEvent,
  MessageDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  GitCommitDetectedEvent,
  UIShortcutEvent,
  UICommandEvent,
} from "./events.ts";

// ── Extension ───────────────────────────────────────────────────
export type { RuntimeExtension } from "./extension.ts";

// ── API ─────────────────────────────────────────────────────────
export type { PlatformAPI } from "./api.ts";

// ── Types ───────────────────────────────────────────────────────
export type {
  RuntimeCommand,
  RuntimeShortcut,
  RuntimePanel,
  RuntimeTool,
  CommandContext,
} from "./types.ts";

// ── Client ──────────────────────────────────────────────────────
export type {
  AgentClient,
  ClientCapabilities,
  ClientSessionState,
  ClientTurnRequest,
} from "./client.ts";

// ── Built-in extensions ─────────────────────────────────────────
export { createGitPolicyExtension } from "./extensions/git-policy.ts";
export type { GitPolicyConfig } from "./extensions/git-policy.ts";
export { createDiffCheckpointExtension } from "./extensions/diff-checkpoint.ts";
export type { DiffCheckpointExtensionInstance } from "./extensions/diff-checkpoint.ts";
export { createSessionCommandsExtension } from "./extensions/session-commands.ts";

// ── FileTracker (moved from @dough/server) ──────────────────────
export { FileTracker } from "./file-tracker.ts";
export type { FileTrackerPersistence, FileTrackerOptions } from "./file-tracker.ts";
