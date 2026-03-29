/**
 * Central keybinding registry for the Dough TUI.
 *
 * Loads from ~/.dough/keybindings.json on startup; any key in the JSON
 * overrides the default below. Unknown keys are ignored.
 *
 * Format in keybindings.json:
 *   { "diffView": "ctrl+d", "abort": "escape", ... }
 */

export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export interface Keybindings {
  /** Open diff view */
  diffView: string;
  /** Open bash output */
  bashOutput: string;
  /** Open thread viewer */
  threadViewer: string;
  /** Abort streaming */
  abort: string;
  /** Open command palette */
  palette: string;
  /** Close / escape overlay */
  close: string;
  /** Cycle themes */
  cycleTheme: string;
  /** Open external editor */
  externalEditor: string;
  /** Copy mode */
  copyMode: string;
  /** History search */
  historySearch: string;
  /** Cycle approval mode */
  approvalMode: string;
}

const DEFAULTS: Keybindings = {
  diffView: "ctrl+d",
  bashOutput: "ctrl+b",
  threadViewer: "ctrl+t",
  abort: "escape",
  palette: "?",
  close: "escape",
  cycleTheme: "ctrl+h",
  externalEditor: "ctrl+e",
  copyMode: "ctrl+y",
  historySearch: "ctrl+r",
  approvalMode: "ctrl+m",
};

let _keybindings: Keybindings = { ...DEFAULTS };

/** Load keybindings from ~/.dough/keybindings.json. Call once at startup. */
export async function loadKeybindings(): Promise<void> {
  try {
    const path = `${process.env.HOME ?? "~"}/.dough/keybindings.json`;
    const raw = await Bun.file(path).text();
    const overrides = JSON.parse(raw) as Partial<Keybindings>;
    _keybindings = { ...DEFAULTS, ...overrides };
  } catch {
    // File doesn't exist or parse error — use defaults
  }
}

/** Get the current active keybindings. */
export function getKeybindings(): Keybindings {
  return _keybindings;
}

/**
 * Returns true if the given KeyEvent matches the binding string.
 * Binding format: "ctrl+d", "escape", "?", "ctrl+shift+r"
 */
export function matchesBinding(key: KeyEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split("+");
  const expectedCtrl = parts.includes("ctrl");
  const expectedMeta = parts.includes("meta");
  const expectedShift = parts.includes("shift");
  const nameParts = parts.filter((p) => !["ctrl", "meta", "shift"].includes(p));
  const expectedName = nameParts.join("+");

  if (!!key.ctrl !== expectedCtrl) return false;
  if (!!key.meta !== expectedMeta) return false;
  if (!!key.shift !== expectedShift) return false;

  // For single characters, match against sequence; for named keys match name
  if (key.name && key.name.toLowerCase() === expectedName) return true;
  if (key.sequence === expectedName) return true;

  return false;
}
