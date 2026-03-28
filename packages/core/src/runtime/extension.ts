/**
 * RuntimeExtension interface.
 *
 * Extensions are the unit of platform behavior in Dough. Each extension
 * receives a PlatformAPI during setup and can register event handlers,
 * commands, shortcuts, panels, and tools.
 *
 * Two categories:
 * - "policy" — runs in core/runtime, can rewrite tool input, enforce commit identity, etc.
 * - "ui" — contributes panels, widgets, palette items, registers shortcuts
 * - "both" — has policy and UI halves
 */

import type { PlatformAPI } from "./api.ts";

export interface RuntimeExtension {
  readonly id: string;
  readonly name: string;
  readonly kind: "policy" | "ui" | "both";
  setup(api: PlatformAPI): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
