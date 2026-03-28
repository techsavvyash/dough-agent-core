/**
 * Runtime UI intent types shared between server and clients.
 *
 * These are wire-safe metadata types (no functions) that flow over
 * WebSocket so any host (TUI, SDK, future web UI) can render
 * runtime contributions.
 */

export interface RuntimeShortcutMeta {
  id: string;
  key: string;
  description: string;
  commandId: string;
}

export interface RuntimeCommandMeta {
  id: string;
  name: string;
  description: string;
  category?: string;
}

export interface RuntimePanelMeta {
  id: string;
  name: string;
  mode: "overlay" | "inline";
}
