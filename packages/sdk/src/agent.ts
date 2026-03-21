import type { DoughEvent, SessionMeta } from "@dough/protocol";
import { DoughEventType } from "@dough/protocol";
import type { DoughSDKConfig, DoughSDKSession } from "./types.ts";

/**
 * Headless agent for programmatic use.
 * Connects to a Dough server via WebSocket.
 *
 * Usage:
 *   const agent = new DoughAgent({ serverUrl: "ws://localhost:4200/ws" });
 *   const session = await agent.session();
 *   for await (const event of session.send("Hello")) {
 *     if (event.type === DoughEventType.ContentDelta) {
 *       process.stdout.write(event.text);
 *     }
 *   }
 */
export class DoughAgent {
  private config: DoughSDKConfig;

  constructor(config: DoughSDKConfig = {}) {
    this.config = {
      serverUrl: config.serverUrl ?? "ws://localhost:4200/ws",
      provider: config.provider ?? "claude",
      model: config.model,
    };
  }

  async session(): Promise<DoughSDKSession> {
    const ws = new WebSocket(this.config.serverUrl!);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Connection failed"));
    });

    let sessionMeta: SessionMeta | null = null;
    let eventResolvers: Array<(event: DoughEvent | null) => void> = [];
    let eventQueue: Array<DoughEvent | null> = [];

    ws.onmessage = (e) => {
      const msg = JSON.parse(
        typeof e.data === "string" ? e.data : e.data.toString()
      );
      if (msg.kind === "session_info") {
        sessionMeta = msg.session;
      } else if (msg.kind === "event") {
        const resolver = eventResolvers.shift();
        if (resolver) {
          resolver(msg.event);
        } else {
          eventQueue.push(msg.event);
        }
      } else if (msg.kind === "error") {
        const resolver = eventResolvers.shift();
        if (resolver) resolver(null);
      }
    };

    ws.onclose = () => {
      // Signal end to any waiting consumers
      for (const r of eventResolvers) r(null);
      eventResolvers = [];
    };

    // Create session
    ws.send(
      JSON.stringify({
        kind: "create",
        provider: this.config.provider,
        model: this.config.model,
      })
    );

    // Wait for session info
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (sessionMeta) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    function nextEvent(): Promise<DoughEvent | null> {
      const queued = eventQueue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => eventResolvers.push(resolve));
    }

    const session: DoughSDKSession = {
      get id() {
        return sessionMeta?.id ?? "";
      },
      get sessionMeta() {
        return sessionMeta;
      },

      async *send(prompt: string) {
        ws.send(JSON.stringify({ kind: "send", prompt }));
        while (true) {
          const event = await nextEvent();
          if (!event) return;
          yield event;
          if (
            event.type === DoughEventType.Finished ||
            event.type === DoughEventType.Aborted
          ) {
            return;
          }
        }
      },

      abort() {
        ws.send(JSON.stringify({ kind: "abort" }));
      },

      async fork(threadId: string, forkPoint?: string) {
        ws.send(JSON.stringify({ kind: "fork", threadId, forkPoint }));
      },

      disconnect() {
        ws.close();
      },
    };

    return session;
  }
}
