import type {
  ClientMessage,
  ServerMessage,
  SessionMeta,
  ThreadMeta,
  DoughEvent,
  DiffPayload,
  McpServerConfig,
  McpServerStatus,
  SkillStatus,
  HistoricalMessage,
  TodoItem,
  RuntimeShortcutMeta,
  RuntimeCommandMeta,
  RuntimePanelMeta,
} from "@dough/protocol";

type EventHandler = (event: DoughEvent) => void;
type SessionHandler = (session: SessionMeta) => void;
type ErrorHandler = (message: string, code?: string) => void;
type ConnectionHandler = () => void;
type DiffsHandler = (payload: DiffPayload) => void;
type ThreadsHandler = (threads: ThreadMeta[]) => void;
type SessionsListHandler = (sessions: SessionMeta[]) => void;
type McpStatusHandler = (servers: McpServerStatus[]) => void;
type SkillsHandler = (skills: SkillStatus[]) => void;
type SkillContentHandler = (name: string, instructions: string) => void;
type QueueUpdateHandler = (position: number) => void;
type ThreadHistoryHandler = (threadId: string, messages: HistoricalMessage[]) => void;
type TodosHandler = (todos: TodoItem[]) => void;
type TodoVerificationRequestHandler = (todoId: string, title: string, instructions: string) => void;
type ShortcutsHandler = (shortcuts: RuntimeShortcutMeta[]) => void;
type CommandsHandler = (commands: RuntimeCommandMeta[]) => void;
type PanelsHandler = (panels: RuntimePanelMeta[]) => void;
type NotifyHandler = (message: string, level: "info" | "warning" | "error") => void;
type StatusHandler = (entries: Record<string, string>) => void;
type OpenPanelHandler = (panelId: string, data?: unknown) => void;

export class DoughClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<EventHandler>();
  private sessionHandlers = new Set<SessionHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private connectHandlers = new Set<ConnectionHandler>();
  private disconnectHandlers = new Set<ConnectionHandler>();
  private diffsHandlers = new Set<DiffsHandler>();
  private threadsHandlers = new Set<ThreadsHandler>();
  private sessionsListHandlers = new Set<SessionsListHandler>();
  private mcpStatusHandlers = new Set<McpStatusHandler>();
  private skillsHandlers = new Set<SkillsHandler>();
  private skillContentHandlers = new Set<SkillContentHandler>();
  private queueUpdateHandlers = new Set<QueueUpdateHandler>();
  private threadHistoryHandlers = new Set<ThreadHistoryHandler>();
  private todosHandlers = new Set<TodosHandler>();
  private todoVerificationRequestHandlers = new Set<TodoVerificationRequestHandler>();
  private shortcutsHandlers = new Set<ShortcutsHandler>();
  private commandsHandlers = new Set<CommandsHandler>();
  private panelsHandlers = new Set<PanelsHandler>();
  private notifyHandlers = new Set<NotifyHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private openPanelHandlers = new Set<OpenPanelHandler>();

  constructor(private serverUrl: string = "ws://localhost:4200/ws") {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        for (const h of this.connectHandlers) h();
        resolve();
      };

      this.ws.onerror = (_e) => {
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onclose = () => {
        for (const h of this.disconnectHandlers) h();
      };

      this.ws.onmessage = (e) => {
        const msg = JSON.parse(
          typeof e.data === "string" ? e.data : e.data.toString()
        ) as ServerMessage;

        switch (msg.kind) {
          case "event":
            for (const h of this.eventHandlers) h(msg.event);
            break;
          case "session_info":
            for (const h of this.sessionHandlers) h(msg.session);
            break;
          case "diffs":
            for (const h of this.diffsHandlers) h(msg.payload);
            break;
          case "sessions_list":
            for (const h of this.sessionsListHandlers) h(msg.sessions);
            break;
          case "threads_list":
            for (const h of this.threadsHandlers) h(msg.threads);
            break;
          case "mcp_status":
            for (const h of this.mcpStatusHandlers) h(msg.servers);
            break;
          case "skills_status":
            for (const h of this.skillsHandlers) h(msg.skills);
            break;
          case "skill_content":
            for (const h of this.skillContentHandlers) h(msg.name, msg.instructions);
            break;
          case "message_queued":
            for (const h of this.queueUpdateHandlers) h(msg.position);
            break;
          case "thread_history":
            for (const h of this.threadHistoryHandlers) h(msg.threadId, msg.messages);
            break;
          case "todos_update":
            for (const h of this.todosHandlers) h(msg.todos);
            break;
          case "todo_verification_request":
            for (const h of this.todoVerificationRequestHandlers)
              h(msg.todoId, msg.title, msg.instructions);
            break;
          case "error":
            for (const h of this.errorHandlers) h(msg.message, msg.code);
            break;
          // Runtime UI intents
          case "runtime:shortcuts":
            for (const h of this.shortcutsHandlers) h(msg.shortcuts);
            break;
          case "runtime:commands":
            for (const h of this.commandsHandlers) h(msg.commands);
            break;
          case "runtime:panels":
            for (const h of this.panelsHandlers) h(msg.panels);
            break;
          case "runtime:notify":
            for (const h of this.notifyHandlers) h(msg.message, msg.level);
            break;
          case "runtime:status":
            for (const h of this.statusHandlers) h(msg.entries);
            break;
          case "runtime:open_panel":
            for (const h of this.openPanelHandlers) h(msg.panelId, msg.data);
            break;
        }
      };
    });
  }

  private sendMessage(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to server");
    }
    this.ws.send(JSON.stringify(msg));
  }

  createSession(provider: string = "claude", model?: string): void {
    this.sendMessage({ kind: "create", provider, model });
  }

  send(prompt: string, threadId?: string, attachments?: import("@dough/protocol").Attachment[]): void {
    this.sendMessage({ kind: "send", prompt, threadId, attachments });
  }

  abort(): void {
    this.sendMessage({ kind: "abort" });
  }

  resume(sessionId: string): void {
    this.sendMessage({ kind: "resume", sessionId });
  }

  fork(threadId: string, forkPoint?: string): void {
    this.sendMessage({ kind: "fork", threadId, forkPoint });
  }

  confirmTool(callId: string, approved: boolean): void {
    this.sendMessage({ kind: "tool_confirmation", callId, approved });
  }

  getDiffs(): void {
    this.sendMessage({ kind: "get_diffs" });
  }

  listSessions(): void {
    this.sendMessage({ kind: "list_sessions" });
  }

  onSessions(handler: SessionsListHandler): () => void {
    this.sessionsListHandlers.add(handler);
    return () => this.sessionsListHandlers.delete(handler);
  }

  listThreads(sessionId?: string): void {
    this.sendMessage({ kind: "list_threads", sessionId });
  }

  switchThread(threadId: string, sessionId: string): void {
    this.sendMessage({ kind: "switch_thread", threadId, sessionId });
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onSession(handler: SessionHandler): () => void {
    this.sessionHandlers.add(handler);
    return () => this.sessionHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  onDiffs(handler: DiffsHandler): () => void {
    this.diffsHandlers.add(handler);
    return () => this.diffsHandlers.delete(handler);
  }

  onThreads(handler: ThreadsHandler): () => void {
    this.threadsHandlers.add(handler);
    return () => this.threadsHandlers.delete(handler);
  }

  // ── MCP commands ────────────────────────────────────────────

  addMcpServer(name: string, config: McpServerConfig): void {
    this.sendMessage({ kind: "mcp_add", name, config });
  }

  removeMcpServer(name: string): void {
    this.sendMessage({ kind: "mcp_remove", name });
  }

  listMcpServers(): void {
    this.sendMessage({ kind: "mcp_list" });
  }

  onMcpStatus(handler: McpStatusHandler): () => void {
    this.mcpStatusHandlers.add(handler);
    return () => this.mcpStatusHandlers.delete(handler);
  }

  // ── Skills commands ──────────────────────────────────────────

  listSkills(): void {
    this.sendMessage({ kind: "skills_list" });
  }

  activateSkill(name: string): void {
    this.sendMessage({ kind: "skill_activate", name });
  }

  onSkills(handler: SkillsHandler): () => void {
    this.skillsHandlers.add(handler);
    return () => this.skillsHandlers.delete(handler);
  }

  onSkillContent(handler: SkillContentHandler): () => void {
    this.skillContentHandlers.add(handler);
    return () => this.skillContentHandlers.delete(handler);
  }

  onQueueUpdate(handler: QueueUpdateHandler): () => void {
    this.queueUpdateHandlers.add(handler);
    return () => this.queueUpdateHandlers.delete(handler);
  }

  onThreadHistory(handler: ThreadHistoryHandler): () => void {
    this.threadHistoryHandlers.add(handler);
    return () => this.threadHistoryHandlers.delete(handler);
  }

  listTodos(sessionId: string): void {
    this.sendMessage({ kind: "todos_list", sessionId });
  }

  verifyTodo(todoId: string, approved: boolean): void {
    this.sendMessage({ kind: "todo_verify", todoId, approved });
  }

  onTodos(handler: TodosHandler): () => void {
    this.todosHandlers.add(handler);
    return () => this.todosHandlers.delete(handler);
  }

  onTodoVerificationRequest(handler: TodoVerificationRequestHandler): () => void {
    this.todoVerificationRequestHandlers.add(handler);
    return () => this.todoVerificationRequestHandlers.delete(handler);
  }

  // ── Runtime commands ─────────────────────────────────────────

  requestContributions(): void {
    this.sendMessage({ kind: "runtime:get_contributions" });
  }

  triggerShortcut(shortcutId: string): void {
    this.sendMessage({ kind: "runtime:shortcut_triggered", shortcutId });
  }

  executeRuntimeCommand(commandId: string, args?: Record<string, unknown>): void {
    this.sendMessage({ kind: "runtime:command", commandId, args });
  }

  onShortcuts(handler: ShortcutsHandler): () => void {
    this.shortcutsHandlers.add(handler);
    return () => this.shortcutsHandlers.delete(handler);
  }

  onCommands(handler: CommandsHandler): () => void {
    this.commandsHandlers.add(handler);
    return () => this.commandsHandlers.delete(handler);
  }

  onPanels(handler: PanelsHandler): () => void {
    this.panelsHandlers.add(handler);
    return () => this.panelsHandlers.delete(handler);
  }

  onNotify(handler: NotifyHandler): () => void {
    this.notifyHandlers.add(handler);
    return () => this.notifyHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onOpenPanel(handler: OpenPanelHandler): () => void {
    this.openPanelHandlers.add(handler);
    return () => this.openPanelHandlers.delete(handler);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
