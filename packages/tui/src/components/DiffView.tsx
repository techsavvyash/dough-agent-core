import { useState, useMemo, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { getTreeSitterClient } from "@opentui/core";
import type { DiffPayload, FileDiff } from "@dough/protocol";
import { colors, hrule } from "../theme.ts";
import { getDoughSyntaxStyle } from "../utils/syntaxStyle.ts";

type ViewMode = "split" | "unified";
type FocusedPanel = "sidebar" | "diff";

interface DiffViewProps {
  payload: DiffPayload;
  onClose: () => void;
}

/**
 * GitHub PR-style diff viewer with syntax highlighting.
 *
 * Uses OpenTUI's native <diff> component for rendering — it handles
 * split/unified layout, line numbers, and tree-sitter syntax highlighting
 * automatically. We own the file-list sidebar and the header/footer chrome.
 *
 * Keyboard:
 *   ← / h      — focus file sidebar
 *   → / l      — focus diff panel
 *   ↑ / k      — prev file (sidebar focused) | scroll up (diff focused)
 *   ↓ / j      — next file (sidebar focused) | scroll down (diff focused)
 *   s          — toggle split ↔ unified
 *   b          — toggle sidebar visibility
 *   Esc / ^D   — close
 *
 * Scroll implementation note:
 *   The <diff> element is virtualised — it has no scrollTop prop. Scrolling
 *   is performed imperatively via diffRef.current.leftCodeRenderable.scrollY
 *   (and rightCodeRenderable for split view). TypeScript `private` is
 *   compile-time only; at runtime those fields are plain JS properties.
 */
export function DiffView({ payload, onClose }: DiffViewProps) {
  const { width, height } = useTerminalDimensions();
  const isNarrow = width < 80;
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("sidebar");
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
  const { diffs, stats } = payload;
  // On narrow screens, always hide sidebar and focus diff
  const effectiveSidebarVisible = sidebarVisible && !isNarrow;

  // Ref to the native <diff> renderable — used for imperative scrolling.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diffRef = useRef<any>(null);

  // Header rule+stat+rule = 3, footer rule = 1, sidebar bottom stats row = 1
  const SIDEBAR_CHROME = 5;
  const sidebarViewport = Math.max(1, height - SIDEBAR_CHROME);

  // Singletons — stable across re-renders
  const syntaxStyle = useMemo(() => getDoughSyntaxStyle(), []);
  const treeSitterClient = useMemo(() => getTreeSitterClient(), []);

  /** Imperatively scroll the diff panel by `delta` lines. */
  function scrollDiff(delta: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = diffRef.current;
    if (!el) return;
    const left = el.leftCodeRenderable;
    if (left) {
      const next = Math.max(0, left.scrollY + delta);
      left.scrollY = next;
    }
    const right = el.rightCodeRenderable;
    if (right) {
      const next = Math.max(0, right.scrollY + delta);
      right.scrollY = next;
    }
  }

  /** Reset the diff scroll to the top (called when switching files). */
  function resetDiffScroll() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = diffRef.current;
    if (!el) return;
    if (el.leftCodeRenderable) el.leftCodeRenderable.scrollY = 0;
    if (el.rightCodeRenderable) el.rightCodeRenderable.scrollY = 0;
  }

  // Also reset imperatively after React re-renders with the new file content.
  useEffect(() => {
    resetDiffScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileIndex]);

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "d")) {
      onClose();
    } else if (key.name === "left" || key.name === "h") {
      // Move focus to the sidebar (or re-show it if hidden)
      setSidebarVisible(true);
      setFocusedPanel("sidebar");
    } else if (key.name === "right" || key.name === "l") {
      // Move focus to the diff panel
      setFocusedPanel("diff");
    } else if (focusedPanel === "sidebar") {
      // j/k/↑/↓ only navigate files when the sidebar owns focus.
      if (key.name === "up" || key.name === "k") {
        resetDiffScroll();
        setSelectedFileIndex((i: number) => {
          const next = i > 0 ? i - 1 : diffs.length - 1;
          setSidebarScrollTop((st) => adjustScrollFlat(next, st, sidebarViewport));
          return next;
        });
      } else if (key.name === "down" || key.name === "j") {
        resetDiffScroll();
        setSelectedFileIndex((i: number) => {
          const next = i < diffs.length - 1 ? i + 1 : 0;
          setSidebarScrollTop((st) => adjustScrollFlat(next, st, sidebarViewport));
          return next;
        });
      } else if (key.name === "s") {
        setViewMode((m: ViewMode) => (m === "split" ? "unified" : "split"));
      } else if (key.name === "b") {
        setSidebarVisible((v: boolean) => !v);
        if (sidebarVisible) setFocusedPanel("diff");
      }
    } else {
      // diff panel focused — j/k scroll the diff content imperatively via ref
      if (key.name === "up" || key.name === "k") {
        scrollDiff(-3);
      } else if (key.name === "down" || key.name === "j") {
        scrollDiff(3);
      } else if (key.name === "s") {
        setViewMode((m: ViewMode) => (m === "split" ? "unified" : "split"));
      } else if (key.name === "b") {
        setSidebarVisible((v: boolean) => !v);
      }
    }
  });

  if (diffs.length === 0) {
    return (
      <box flexDirection="column" height="100%">
        <box height={1}><text fg={colors.border}>{hrule(width)}</text></box>
        <box paddingX={2} flex={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>No file changes in this session.</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>Press Esc to close</text>
        </box>
      </box>
    );
  }

  const sel = diffs[selectedFileIndex];
  if (!sel) return null;

  const FILE_LIST_W = Math.min(34, Math.floor(width * 0.22));
  const rule = hrule(width);
  const isSplit = viewMode === "split";

  return (
    <box flexDirection="column" height="100%">

      {/* ── Header ── */}
      <box height={1}><text fg={colors.border}>{rule}</text></box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={colors.primary}>{"Changes  "}</text>
        <text fg={colors.accent}>{`${stats.filesChanged} ${stats.filesChanged === 1 ? "file" : "files"}  `}</text>
        <text fg={colors.success}>{`+${stats.totalAdded}  `}</text>
        <text fg={colors.error}>{`-${stats.totalRemoved}  `}</text>
        <text fg={colors.textMuted}>{`   ←→/h/l focus panel · ↑↓/j/k ${focusedPanel === "sidebar" ? "navigate files" : "scroll diff"} · s ${isSplit ? "→ unified" : "→ split"} · b ${effectiveSidebarVisible ? "hide" : "show"} files · Esc close`}</text>
      </box>
      <box height={1}><text fg={colors.border}>{rule}</text></box>

      {/* ── Body ── */}
      <box flex={1} flexDirection="row">

        {/* File list panel — collapsible with `b` */}
        {effectiveSidebarVisible && (
          <box width={FILE_LIST_W} flexDirection="column" border={["right"]} borderFg={focusedPanel === "sidebar" ? colors.accent : colors.border}>
            <scrollbox flex={1} scrollTop={sidebarScrollTop}>
              {diffs.map((diff, i) => {
                const isSel = i === selectedFileIndex;
                return (
                  <box key={diff.filePath} height={1} paddingX={1} flexDirection="row">
                    <text fg={isSel ? colors.accent : colors.textMuted}>{isSel ? "▶ " : "  "}</text>
                    <text fg={getStatusColor(diff.status)}>{getStatusIcon(diff.status) + " "}</text>
                    <text fg={isSel ? colors.text : colors.textDim}>
                      {shortenPath(diff.filePath, FILE_LIST_W - 7)}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
            {/* Stats for selected file */}
            <box height={1} paddingX={1} flexDirection="row">
              <text fg={colors.success}>{`+${sel.linesAdded} `}</text>
              <text fg={colors.error}>{`-${sel.linesRemoved}`}</text>
            </box>
          </box>
        )}

        {/* Diff panel — native <diff> with tree-sitter syntax highlighting.
            Scroll is controlled imperatively via diffRef (see scrollDiff / resetDiffScroll).
            The <diff> element is virtualised and has no scrollTop prop. */}
        <box flex={1} flexDirection="column" borderFg={focusedPanel === "diff" ? colors.accent : colors.border}>
          {/* File path + language tag */}
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={getStatusColor(sel.status)}>{getStatusIcon(sel.status) + "  "}</text>
            <text fg={focusedPanel === "diff" ? colors.text : colors.textDim}>{sel.filePath}</text>
            {sel.language ? <text fg={colors.textMuted}>{`  [${sel.language}]`}</text> : null}
            {focusedPanel === "diff" && (
              <text fg={colors.accent}>{"  ●"}</text>
            )}
          </box>

          {/* <diff> is a virtualised native element — scroll is imperative via ref */}
          <diff
            ref={diffRef}
            flex={1}
            diff={sel.unifiedDiff}
            filetype={sel.language}
            view={viewMode}
            syntaxStyle={syntaxStyle}
            treeSitterClient={treeSitterClient}
            showLineNumbers={true}
            wrapMode="word"
            fg={colors.text}
            // Line gutter (line-number column) backgrounds
            addedLineNumberBg="#0e2010"
            removedLineNumberBg="#20100e"
            contextBg="transparent"
            lineNumberFg={colors.textMuted}
            // Content area backgrounds — slightly lighter so code pops
            addedBg="#0e2010"
            removedBg="#20100e"
            addedContentBg="#162816"
            removedContentBg="#281618"
            // +/- sign colours
            addedSignColor={colors.success}
            removedSignColor={colors.error}
          />
        </box>

      </box>

      {/* ── Footer ── */}
      <box height={1}><text fg={colors.border}>{rule}</text></box>
    </box>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStatusIcon(status: FileDiff["status"]): string {
  switch (status) {
    case "added":    return "A";
    case "modified": return "M";
    case "deleted":  return "D";
  }
}

function getStatusColor(status: FileDiff["status"]): string {
  switch (status) {
    case "added":    return colors.success;
    case "modified": return colors.accent;
    case "deleted":  return colors.error;
  }
}

/**
 * Return a scrollTop that keeps a flat list item (all items height=1) visible.
 * Scrolls minimally — only moves if the item falls outside the viewport.
 */
function adjustScrollFlat(index: number, scrollTop: number, viewportHeight: number): number {
  if (index < scrollTop) return index;
  if (index >= scrollTop + viewportHeight) return index - viewportHeight + 1;
  return scrollTop;
}

/** Shorten a path to fit within maxLen chars, removing leading segments. */
function shortenPath(filePath: string, maxLen: number): string {
  if (filePath.length <= maxLen) return filePath;
  const parts = filePath.split("/");
  for (let skip = 1; skip < parts.length; skip++) {
    const candidate = "…/" + parts.slice(skip).join("/");
    if (candidate.length <= maxLen) return candidate;
  }
  return "…" + filePath.slice(-(maxLen - 1));
}
