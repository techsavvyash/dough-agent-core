import { useEffect, useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Attachment } from "@dough/protocol";
import { DoughClient } from "./client.ts";
import { useSession } from "./hooks/useSession.ts";
import { useChangeStats } from "./hooks/useChangeStats.ts";
import { useThreads } from "./hooks/useThreads.ts";
import { loadLastSessionId, saveLastSessionId } from "./utils/sessionStore.ts";
import { Header } from "./components/Header.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { Composer } from "./components/Composer.tsx";
import { DiffView } from "./components/DiffView.tsx";
import { ThreadViewer } from "./components/ThreadViewer.tsx";
import {
  CommandPalette,
  COMMANDS,
} from "./components/CommandPalette.tsx";
import { colors } from "./theme.ts";

interface AppProps {
  serverUrl: string;
  provider: string;
  model?: string;
}

export function App({ serverUrl, provider, model }: AppProps) {
  const [client] = useState(() => new DoughClient(serverUrl));
  const {
    messages,
    isStreaming,
    queuedCount,
    session,
    error,
    connected,
    send,
    abort,
    clearMessages,
    addSystemMessage,
  } = useSession(client);
  const { stats, diffPayload, requestDiffs, clearDiffs, hasChanges } =
    useChangeStats(client);
  const { threads, requestThreads, requestAllThreads } = useThreads(client);
  const { height: termHeight } = useTerminalDimensions();
  const [initError, setInitError] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showDiffView, setShowDiffView] = useState(false);
  const [showThreadViewer, setShowThreadViewer] = useState(false);

  const noOverlay = !showPalette && !showDiffView && !showThreadViewer;

  // Ctrl+D to enter diff mode
  useKeyboard((key) => {
    if (key.ctrl && key.name === "d" && noOverlay) {
      if (hasChanges) {
        requestDiffs();
        setShowDiffView(true);
      }
    }
    // Ctrl+T to open thread viewer
    if (key.ctrl && key.name === "t" && noOverlay) {
      requestAllThreads();
      setShowThreadViewer(true);
    }
  });

  // Persist session ID whenever a new session is received
  useEffect(() => {
    if (session?.id) {
      saveLastSessionId(session.id);
    }
  }, [session?.id]);

  useEffect(() => {
    let settled = false;

    client
      .connect()
      .then(async () => {
        const lastId = await loadLastSessionId();

        if (lastId) {
          // Try to resume the previous session first
          const unsubError = client.onError((_msg: string, code?: string) => {
            if (code === "SESSION_NOT_FOUND" && !settled) {
              settled = true;
              unsubError();
              // Server doesn't know this session — start fresh
              client.createSession(provider, model);
            }
          });

          const unsubSession = client.onSession(() => {
            if (!settled) {
              settled = true;
              unsubError();
              unsubSession();
            }
          });

          client.resume(lastId);
        } else {
          client.createSession(provider, model);
        }
      })
      .catch((err: unknown) => {
        setInitError(
          err instanceof Error ? err.message : "Failed to connect"
        );
      });

    return () => client.disconnect();
  }, [client, provider, model]);

  const handleSubmit = useCallback(
    (text: string, attachments?: Attachment[]) => {
      // Slash commands open palette or execute directly (no attachments)
      if (text === "?" || text === "/") {
        setShowPalette(true);
        return;
      }

      // Handle inline slash commands
      if (text.startsWith("/") && !attachments?.length) {
        const cmd = text.slice(1).trim().toLowerCase();
        executeCommand(cmd);
        return;
      }

      send(text, attachments);
    },
    [send]
  );

  const executeCommand = useCallback(
    (cmd: string) => {
      setShowPalette(false);

      switch (cmd) {
        case "thread_info":
        case "thread info": {
          const threadId = session?.activeThreadId ?? "unknown";
          const sessionId = session?.id ?? "unknown";
          addSystemMessage(
            `Thread: ${threadId}\nSession: ${sessionId}\nProvider: ${session?.provider ?? "unknown"}\nModel: ${session?.model ?? "default"}`
          );
          break;
        }

        case "thread_fork":
        case "thread fork": {
          if (session?.activeThreadId) {
            client.fork(session.activeThreadId);
            addSystemMessage("Forking current thread...");
          } else {
            addSystemMessage("No active thread to fork.");
          }
          break;
        }

        case "thread_new":
        case "thread new": {
          client.createSession(provider, model);
          clearMessages();
          addSystemMessage("Started new thread.");
          break;
        }

        case "clear": {
          clearMessages();
          break;
        }

        case "compact": {
          addSystemMessage(
            "Compacting: summarizing context and handing off to new thread..."
          );
          send("/compact");
          break;
        }

        case "thread_list":
        case "thread list": {
          // Fetch all threads across all sessions (not just the current one)
          requestAllThreads();
          setShowThreadViewer(true);
          break;
        }

        case "exit": {
          process.exit(0);
          break;
        }

        default:
          addSystemMessage(`Unknown command: ${cmd}`);
      }
    },
    [session, client, provider, model, send, clearMessages, addSystemMessage, requestThreads, requestAllThreads]
  );

  const handlePaletteSelect = useCallback(
    (value: string) => {
      setShowPalette(false);
      executeCommand(value);
    },
    [executeCommand]
  );

  const handleSwitchThread = useCallback(
    (thread: import("@dough/protocol").ThreadMeta) => {
      client.switchThread(thread.id, thread.sessionId);
      setShowThreadViewer(false);
      clearMessages();
      addSystemMessage(`Switching to thread ${thread.id.slice(0, 8)}…`);
    },
    [client, clearMessages, addSystemMessage]
  );

  // Full-screen thread viewer overlay
  if (showThreadViewer) {
    return (
      <ThreadViewer
        threads={threads}
        activeThreadId={session?.activeThreadId ?? ""}
        onClose={() => setShowThreadViewer(false)}
        onSwitch={handleSwitchThread}
      />
    );
  }

  // Full-screen diff mode overlay
  if (showDiffView && diffPayload) {
    return (
      <DiffView
        payload={diffPayload}
        onClose={() => {
          setShowDiffView(false);
          clearDiffs();
        }}
      />
    );
  }

  return (
    <box flexDirection="column" height="100%">
      {/* ── Header ─────────────────────────────── fixed top */}
      <Header session={session} connected={connected} />

      {/* ── Chat area ──────────────────────────── fills middle, scrollable */}
      <scrollbox flex={1} stickyScroll stickyStart="bottom">
        {initError ? (
          <box paddingX={2} flexDirection="column" gap={1}>
            <text fg={colors.error}>Connection error: {initError}</text>
            <text fg={colors.textDim}>
              Start the server: bun run server
            </text>
          </box>
        ) : (
          <ChatView messages={messages} isStreaming={isStreaming} />
        )}
      </scrollbox>

      {/* ── Error banner ───────────────────────── conditional */}
      {error && (
        <box paddingX={2} height={1}>
          <text fg={colors.error}>{error}</text>
        </box>
      )}

      {/* ── Command palette ────────────────────── inline above composer, scrollbox shrinks */}
      {showPalette && (
        <CommandPalette
          commands={COMMANDS}
          onSelect={handlePaletteSelect}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* ── Composer ───────────────────────────── fixed bottom, first-class */}
      <Composer
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        queuedCount={queuedCount}
        onAbort={abort}
        onOpenPalette={() => setShowPalette(true)}
        stats={stats}
        hasChanges={hasChanges}
      />
    </box>
  );
}
