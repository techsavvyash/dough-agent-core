import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Attachment } from "@dough/protocol";
import { DoughClient } from "./client.ts";
import { useSession } from "./hooks/useSession.ts";
import { useChangeStats } from "./hooks/useChangeStats.ts";
import { useThreads } from "./hooks/useThreads.ts";
import { useRuntimeContributions } from "./hooks/useRuntimeContributions.ts";
import { loadLastSessionId, saveLastSessionId } from "./utils/sessionStore.ts";
import { Header } from "./components/Header.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { Composer } from "./components/Composer.tsx";
import { DiffView } from "./components/DiffView.tsx";
import { ThreadViewer } from "./components/ThreadViewer.tsx";
import { BashOutputView, type BashCallEntry } from "./components/BashOutputView.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { StatusBar, type ApprovalMode } from "./components/StatusBar.tsx";
import { HistorySearch } from "./components/HistorySearch.tsx";
import { CopyMode } from "./components/CopyMode.tsx";
import { SessionBrowser } from "./components/SessionBrowser.tsx";
import { ModelSelector } from "./components/ModelSelector.tsx";
import { useGitBranch } from "./hooks/useGitBranch.ts";
import { useSessions } from "./hooks/useSessions.ts";
import { colors } from "./theme.ts";
import { THEMES, saveThemeName, loadThemeName } from "./themes/index.ts";
import type { Theme } from "./themes/index.ts";

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
    totalTokens,
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
  const { threads, requestAllThreads } = useThreads(client);
  const { sessions, requestSessions } = useSessions(client);
  const gitBranch = useGitBranch();
  const { shortcuts, commands } = useRuntimeContributions(client);
  // Ref so callbacks always see the latest commands even if OpenTUI caches
  // the onSubmit handler and doesn't update when the React prop changes.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const { height: termHeight } = useTerminalDimensions();
  const [activeTheme, setActiveTheme] = useState<Theme>(THEMES[0]!);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("auto");
  const [initError, setInitError] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showDiffView, setShowDiffView] = useState(false);
  const [showThreadViewer, setShowThreadViewer] = useState(false);
  const [showBashOutput, setShowBashOutput] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [showCopyMode, setShowCopyMode] = useState(false);
  const [showSessionBrowser, setShowSessionBrowser] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [composerFillText, setComposerFillText] = useState<string | null>(null);
  /** Flat list of every bash tool call across all messages — used by BashOutputView. */
  const bashCalls = useMemo<BashCallEntry[]>(() => {
    const acc: BashCallEntry[] = [];
    for (const msg of messages) {
      for (const tc of msg.toolCalls ?? []) {
        if (tc.name === "Bash" || tc.name === "bash" || tc.name === "execute" || tc.name === "command_execution") {
          acc.push({
            callId: tc.callId,
            command: String(tc.args.command ?? ""),
            output: tc.output,
            status: tc.status,
          });
        }
      }
    }
    return acc;
  }, [messages]);

  const noOverlay = !showPalette && !showDiffView && !showThreadViewer && !showBashOutput
    && !showCopyMode && !showSessionBrowser && !showModelSelector;

  // Load saved theme preference on mount
  useEffect(() => {
    loadThemeName().then((name) => {
      if (name) {
        const found = THEMES.find((t) => t.name === name);
        if (found) setActiveTheme(found);
      }
    });
  }, []);

  // Dynamic keyboard shortcuts from runtime contributions
  useKeyboard((key) => {
    if (!noOverlay) {
      // Ctrl+R: history search (dismiss other overlays don't block this)
      if (key.ctrl && key.name === "r" && !showHistorySearch) {
        setShowHistorySearch(true);
      }
      return;
    }

    // Ctrl+H: cycle through themes
    if (key.ctrl && key.name === "h") {
      setActiveTheme((prev) => {
        const idx = THEMES.findIndex((t) => t.name === prev.name);
        const next = THEMES[(idx + 1) % THEMES.length]!;
        saveThemeName(next.name);
        return next;
      });
      return;
    }

    // Ctrl+M: cycle approval mode
    if (key.ctrl && key.name === "m") {
      const modes: ApprovalMode[] = ["auto", "plan", "confirm"];
      setApprovalMode((prev) => {
        const idx = modes.indexOf(prev);
        return modes[(idx + 1) % modes.length]!;
      });
      return;
    }

    // Ctrl+R: open history search
    if (key.ctrl && key.name === "r") {
      setShowHistorySearch(true);
      return;
    }

    // Ctrl+Y: open copy mode
    if (key.ctrl && key.name === "y") {
      setShowCopyMode(true);
      return;
    }

    // Ctrl+Shift+S (or just use Ctrl+shift — terminal sends ctrl+s as XON, so avoid)
    // Instead, open session browser via Ctrl+\ (backslash)
    if (key.ctrl && key.name === "\\") {
      requestSessions();
      setShowSessionBrowser(true);
      return;
    }

    // Build the key string to match against runtime shortcuts
    const parts: string[] = [];
    if (key.ctrl) parts.push("ctrl");
    if (key.meta) parts.push("meta");
    if (key.name) parts.push(key.name);
    const keyStr = parts.join("+");

    const matched = shortcuts.find((s) => s.key === keyStr);
    if (!matched) return;

    // Delegate all shortcuts to the server — the server executes the linked
    // command and sends back UI intents (runtime:open_panel, runtime:notify)
    // which the onOpenPanel/onNotify listeners handle.
    client.triggerShortcut(matched.id);
  });

  // Listen for runtime panel open intents from the server
  useEffect(() => {
    return client.onOpenPanel((panelId) => {
      switch (panelId) {
        case "diff.panel":
          requestDiffs();
          setShowDiffView(true);
          break;
        case "threads.panel":
          requestAllThreads();
          setShowThreadViewer(true);
          break;
        case "bash.panel":
          if (bashCalls.length > 0) setShowBashOutput(true);
          break;
        case "model.panel":
          setShowModelSelector(true);
          break;
      }
    });
  }, [client, requestDiffs, requestAllThreads, bashCalls.length]);

  // Listen for runtime notifications and display them as system messages
  useEffect(() => {
    return client.onNotify((message, _level) => {
      // Special signal from session-commands extension to clear chat
      if (message === "__clear__") {
        clearMessages();
        return;
      }
      addSystemMessage(message);
    });
  }, [client, addSystemMessage, clearMessages]);

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

  // Build command palette items from runtime contributions
  const paletteCommands = useMemo(
    () =>
      commands.map((c) => ({
        name: c.name,
        description: c.description,
        value: c.id,
      })),
    [commands]
  );

  const executeCommand = useCallback(
    (commandId: string, args?: Record<string, unknown>) => {
      setShowPalette(false);

      // Exit is inherently local — must terminate the TUI process
      if (commandId === "session.exit") {
        process.exit(0);
        return;
      }

      // All other commands delegate to the server. The server executes the
      // command handler, performs any side-effects (fork, new session, compact),
      // and sends back UI intents (runtime:notify, runtime:open_panel) that
      // the onNotify/onOpenPanel listeners handle.
      client.executeRuntimeCommand(commandId, args);
    },
    [client]
  );

  const handleSubmit = useCallback(
    (text: string, attachments?: Attachment[]) => {
      // Slash commands open palette or execute directly (no attachments)
      if (text === "?" || text === "/") {
        setShowPalette(true);
        return;
      }

      // Handle inline slash commands
      if (text.startsWith("/") && !attachments?.length) {
        const rawCmd = text.slice(1).trim().toLowerCase();
        const cmds = commandsRef.current;

        // Try exact match first
        let matched = cmds.find(
          (c) =>
            c.name.replace(/^\//, "").toLowerCase() === rawCmd ||
            c.id.split(".").pop() === rawCmd
        );

        // Try prefix match for commands with arguments (e.g. "/provider claude")
        let cmdArgs: Record<string, unknown> | undefined;
        if (!matched) {
          const parts = rawCmd.split(/\s+/);
          const cmdName = parts[0]!;
          const argStr = parts.slice(1).join(" ");
          matched = cmds.find(
            (c) =>
              c.name.replace(/^\//, "").toLowerCase() === cmdName ||
              c.id.split(".").pop() === cmdName
          );
          if (matched && argStr) {
            // For /provider, pass the provider name as { provider: "claude" }
            if (matched.id === "session.provider_switch") {
              cmdArgs = { provider: argStr };
            }
          }
        }

        if (matched) {
          executeCommand(matched.id, cmdArgs);
        } else {
          addSystemMessage(`Unknown command: ${rawCmd}`);
        }
        return;
      }

      send(text, attachments);
    },
    [send, addSystemMessage, executeCommand]
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

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setShowModelSelector(false);
      client.switchModel(modelId);
      addSystemMessage(`Switching model to ${modelId}...`);
    },
    [client, addSystemMessage],
  );

  // Full-screen copy mode overlay
  if (showCopyMode) {
    return (
      <CopyMode
        messages={messages}
        onClose={() => setShowCopyMode(false)}
      />
    );
  }

  // Full-screen session browser overlay
  if (showSessionBrowser) {
    return (
      <SessionBrowser
        sessions={sessions}
        activeSessionId={session?.id ?? ""}
        onClose={() => setShowSessionBrowser(false)}
        onSwitch={(s) => {
          setShowSessionBrowser(false);
          clearMessages();
          client.resume(s.id);
          addSystemMessage(`Resuming session ${s.id.slice(0, 8)}…`);
        }}
      />
    );
  }

  // Full-screen bash output overlay
  if (showBashOutput) {
    return (
      <BashOutputView
        calls={bashCalls}
        onClose={() => setShowBashOutput(false)}
      />
    );
  }

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
    <box flexDirection="column" height={termHeight || 40}>
      {/* ── Header ─────────────────────────────── fixed top */}
      <Header session={session} connected={connected} />

      {/* ── Chat area ──────────────────────────── fills middle, scrollable */}
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
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

      {/* ── Status bar ────────────────────────── live metrics */}
      <StatusBar
        model={session?.model ?? ""}
        provider={session?.provider ?? provider}
        totalTokens={totalTokens}
        threadCount={threads.length}
        gitBranch={gitBranch}
        approvalMode={approvalMode}
        themeName={activeTheme.name}
      />

      {/* ── Error banner ───────────────────────── conditional */}
      {error && (
        <box paddingX={2} height={1}>
          <text fg={colors.error}>{error}</text>
        </box>
      )}

      {/* ── Command palette ────────────────────── inline above composer, scrollbox shrinks */}
      {showPalette && (
        <CommandPalette
          commands={paletteCommands}
          onSelect={handlePaletteSelect}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* ── Model selector ───────────────────────── inline above composer */}
      {showModelSelector && (
        <ModelSelector
          provider={session?.provider ?? provider}
          currentModel={session?.model ?? ""}
          onSelect={handleModelSelect}
          onClose={() => setShowModelSelector(false)}
        />
      )}

      {/* ── History search ─────────────────────── inline above composer */}
      {showHistorySearch && (
        <HistorySearch
          messages={messages}
          onSelect={(text) => {
            setComposerFillText(text);
            setShowHistorySearch(false);
          }}
          onClose={() => setShowHistorySearch(false)}
        />
      )}

      {/* ── Composer ───────────────────────────── fixed bottom, first-class */}
      <Composer
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        queuedCount={queuedCount}
        onAbort={abort}
        onOpenPalette={() => setShowPalette(true)}
        paletteOpen={showPalette || showHistorySearch || showModelSelector}
        stats={stats}
        hasChanges={hasChanges}
        fillText={composerFillText}
        onFillConsumed={() => setComposerFillText(null)}
        messages={messages}
      />
    </box>
  );
}
