import type {
  ClientMessage,
  ServerMessage,
  SessionMeta,
  DoughEvent,
} from "@dough/protocol";

type EventHandler = (event: DoughEvent) => void;
type SessionHandler = (session: SessionMeta) => void;
type ErrorHandler = (message: string, code?: string) => void;
type ConnectionHandler = () => void;

export class DoughClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<EventHandler>();
  private sessionHandlers = new Set<SessionHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private connectHandlers = new Set<ConnectionHandler>();
  private disconnectHandlers = new Set<ConnectionHandler>();

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

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
