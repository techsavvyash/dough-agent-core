/**
 * PlatformRuntime — the central orchestrator.
 *
 * Owns the event bus, extension lifecycle, and all registries for
 * commands, shortcuts, panels, and tools. The server binds it to
 * WebSocket and the TUI renders its UI intents.
 */

import { EventBus, type PlatformEventHandler } from "./event-bus.ts";
import type {
  PlatformEventType,
  PlatformEventOfType,
} from "./events.ts";
import type { PlatformAPI } from "./api.ts";
import type { RuntimeExtension } from "./extension.ts";
import type { AgentClient } from "./client.ts";
import type {
  RuntimeCommand,
  RuntimeShortcut,
  RuntimePanel,
  RuntimeTool,
} from "./types.ts";

export interface PlatformRuntimeConfig {
  cwd?: string;
}

export interface Notification {
  message: string;
  level: "info" | "warning" | "error";
}

export interface PanelOpenIntent {
  panelId: string;
  data?: unknown;
}

export class PlatformRuntime {
  private bus: EventBus;
  private extensions = new Map<string, RuntimeExtension>();
  private commands = new Map<string, RuntimeCommand>();
  private shortcuts = new Map<string, RuntimeShortcut>();
  private panels = new Map<string, RuntimePanel>();
  private tools = new Map<string, RuntimeTool>();
  private client: AgentClient | null = null;
  private sessionState = new Map<string, unknown>();
  private notifications: Notification[] = [];
  private statusEntries = new Map<string, string>();
  private panelOpenQueue: PanelOpenIntent[] = [];
  private initialized = false;

  // Current session state
  private currentSessionId: string | null = null;
  private currentThreadId: string | null = null;
  readonly cwd: string;

  constructor(config?: PlatformRuntimeConfig) {
    this.bus = new EventBus();
    this.cwd = config?.cwd ?? process.cwd();
  }

  // ── Extension lifecycle ───────────────────────────────────────

  /**
   * Register an extension. Must be called before initialize().
   */
  registerExtension(ext: RuntimeExtension): void {
    if (this.extensions.has(ext.id)) {
      throw new Error(`Extension "${ext.id}" is already registered`);
    }
    this.extensions.set(ext.id, ext);
  }

  /**
   * Initialize all registered extensions by calling their setup().
   * Extensions receive a scoped PlatformAPI instance.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const ext of this.extensions.values()) {
      const api = this.createAPI(ext.id);
      await ext.setup(api);
    }
    this.initialized = true;
  }

  /**
   * Dispose all extensions and clear state.
   */
  async dispose(): Promise<void> {
    for (const ext of this.extensions.values()) {
      await ext.dispose?.();
    }
    this.bus.clear();
    this.extensions.clear();
    this.commands.clear();
    this.shortcuts.clear();
    this.panels.clear();
    this.tools.clear();
    this.sessionState.clear();
    this.notifications = [];
    this.statusEntries.clear();
    this.panelOpenQueue = [];
    this.initialized = false;
  }

  // ── Client management ─────────────────────────────────────────

  registerClient(client: AgentClient): void {
    this.client = client;
  }

  getClient(): AgentClient | null {
    return this.client;
  }

  // ── Event dispatch ────────────────────────────────────────────

  async emit<T extends PlatformEventType>(
    event: PlatformEventOfType<T>,
  ): Promise<void> {
    await this.bus.emit(event);
  }

  // ── Accessors for server/host integration ─────────────────────

  getCommands(): RuntimeCommand[] {
    return Array.from(this.commands.values());
  }

  getCommand(id: string): RuntimeCommand | undefined {
    return this.commands.get(id);
  }

  getShortcuts(): RuntimeShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  getPanels(): RuntimePanel[] {
    return Array.from(this.panels.values());
  }

  getTools(): RuntimeTool[] {
    return Array.from(this.tools.values());
  }

  getExtension<T extends RuntimeExtension>(id: string): T | undefined {
    return this.extensions.get(id) as T | undefined;
  }

  /**
   * Drain all pending notifications. Returns and clears the queue.
   */
  drainNotifications(): Notification[] {
    const result = this.notifications;
    this.notifications = [];
    return result;
  }

  /**
   * Drain all pending panel open intents.
   */
  drainPanelOpenIntents(): PanelOpenIntent[] {
    const result = this.panelOpenQueue;
    this.panelOpenQueue = [];
    return result;
  }

  getStatus(): Map<string, string> {
    return new Map(this.statusEntries);
  }

  // ── Session lifecycle ─────────────────────────────────────────

  setSession(sessionId: string, threadId: string): void {
    this.currentSessionId = sessionId;
    this.currentThreadId = threadId;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  getActiveThreadId(): string | null {
    return this.currentThreadId;
  }

  // ── Private: create scoped API for an extension ───────────────

  private createAPI(extensionId: string): PlatformAPI {
    const runtime = this;

    return {
      // Events
      on<T extends PlatformEventType>(
        type: T,
        handler: PlatformEventHandler<T>,
      ): () => void {
        return runtime.bus.on(type, handler);
      },

      // Registrations
      registerTool(tool: RuntimeTool): void {
        runtime.tools.set(tool.name, tool);
      },
      registerCommand(command: RuntimeCommand): void {
        runtime.commands.set(command.id, command);
      },
      registerShortcut(shortcut: RuntimeShortcut): void {
        runtime.shortcuts.set(shortcut.id, shortcut);
      },
      registerPanel(panel: RuntimePanel): void {
        runtime.panels.set(panel.id, panel);
      },

      // UI intents
      notify(message: string, level: "info" | "warning" | "error" = "info"): void {
        runtime.notifications.push({ message, level });
      },
      setStatus(key: string, value?: string): void {
        if (value === undefined) {
          runtime.statusEntries.delete(key);
        } else {
          runtime.statusEntries.set(key, value);
        }
      },
      openPanel(panelId: string, data?: unknown): void {
        runtime.panelOpenQueue.push({ panelId, data });
      },

      // Session state (namespaced by extension)
      getSessionState<T>(namespace: string): T | undefined {
        return runtime.sessionState.get(`${extensionId}:${namespace}`) as
          | T
          | undefined;
      },
      setSessionState<T>(namespace: string, value: T): void {
        runtime.sessionState.set(`${extensionId}:${namespace}`, value);
      },

      // Read-only accessors
      get cwd() {
        return runtime.cwd;
      },
      get sessionId() {
        return runtime.currentSessionId;
      },
      get activeThreadId() {
        return runtime.currentThreadId;
      },
    };
  }
}
