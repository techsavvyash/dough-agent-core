import { useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { DoughClient } from "./client.ts";
import { useSession } from "./hooks/useSession.ts";
import { useChangeStats } from "./hooks/useChangeStats.ts";
import { useThreads } from "./hooks/useThreads.ts";
import { Header } from "./components/Header.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
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
  const { threads, requestThreads } = useThreads(client);
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
      if (session?.id) {
        requestThreads(session.id);
        setShowThreadViewer(true);
      }
    }
  });

  useEffect(() => {
    client
      .connect()
      .then(() => {
        client.createSession(provider, model);
      })
      .catch((err) => {
        setInitError(
          err instanceof Error ? err.message : "Failed to connect"
        );
      });

    return () => client.disconnect();
  }, [client, provider, model]);

  const handleSubmit = useCallback(
    (text: string) => {
      // Slash commands open palette or execute directly
      if (text === "?" || text === "/") {
        setShowPalette(true);
        return;
      }

      // Handle inline slash commands
      if (text.startsWith("/")) {
        const cmd = text.slice(1).trim().toLowerCase();
        executeCommand(cmd);
        return;
      }

      send(text);
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
          // The server handles handoff automatically when tokens exceed the cap.
          // For manual compact, send a signal to the server.
          send("/compact");
          break;
        }

        case "thread_list":
        case "thread list": {
          if (session?.id) {
            requestThreads(session.id);
            setShowThreadViewer(true);
          } else {
            addSystemMessage("No active session.");
          }
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
    [session, client, provider, model, send, clearMessages, addSystemMessage, requestThreads]
  );

  const handlePaletteSelect = useCallback(
    (value: string) => {
      setShowPalette(false);
      executeCommand(value);
    },
    [executeCommand]
  );

  // Full-screen thread viewer overlay
  if (showThreadViewer) {
    return (
      <ThreadViewer
        threads={threads}
        activeThreadId={session?.activeThreadId ?? ""}
        onClose={() => setShowThreadViewer(false)}
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
      <Header session={session} connected={connected} />

      <scrollbox flex={1} focused={false}>
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

      {error && (
        <box paddingX={2}>
          <text fg={colors.error}>{error}</text>
        </box>
      )}

      {showPalette && (
        <CommandPalette
          commands={COMMANDS}
          onSelect={handlePaletteSelect}
          onClose={() => setShowPalette(false)}
        />
      )}
      {!showPalette && (
        <>
          <InputBar
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
            onAbort={abort}
          />
          <StatusLine
            stats={stats}
            diffModeHint={hasChanges ? "Ctrl+D for diffs" : ""}
          />
        </>
      )}
    </box>
  );
}
