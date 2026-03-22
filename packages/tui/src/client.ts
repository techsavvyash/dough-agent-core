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
} from "@dough/protocol";

type EventHandler = (event: DoughEvent) => void;
type SessionHandler = (session: SessionMeta) => void;
type ErrorHandler = (message: string, code?: string) => void;
type ConnectionHandler = () => void;
type DiffsHandler = (payload: DiffPayload) => void;
type ThreadsHandler = (threads: ThreadMeta[]) => void;
type McpStatusHandler = (servers: McpServerStatus[]) => void;
type SkillsHandler = (skills: SkillStatus[]) => void;
type SkillContentHandler = (name: string, instructions: string) => void;
type QueueUpdateHandler = (position: number) => void;

export class DoughClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<EventHandler>();
  private sessionHandlers = new Set<SessionHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private connectHandlers = new Set<ConnectionHandler>();
  private disconnectHandlers = new Set<ConnectionHandler>();
  private diffsHandlers = new Set<DiffsHandler>();
  private threadsHandlers = new Set<ThreadsHandler>();
  private mcpStatusHandlers = new Set<McpStatusHandler>();
  private skillsHandlers = new Set<SkillsHandler>();
  private skillContentHandlers = new Set<SkillContentHandler>();
  private queueUpdateHandlers = new Set<QueueUpdateHandler>();

  constructor(private serverUrl: string = "ws://localhost:4200/ws") {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        for (const h of this.connectHandlers) h();
        resolve();
      };

      this.ws.onerror = (e) => {
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
          case "error":
            for (const h of this.errorHandlers) h(msg.message, msg.code);
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

  send(prompt: string, threadId?: string): void {
    this.sendMessage({ kind: "send", prompt, threadId });
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

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
