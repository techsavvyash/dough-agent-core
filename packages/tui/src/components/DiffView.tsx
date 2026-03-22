import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { DiffPayload, FileDiff } from "@dough/protocol";
import { colors, hrule } from "../theme.ts";

type ViewMode = "split" | "unified";

interface DiffViewProps {
  payload: DiffPayload;
  onClose: () => void;
}

/**
 * GitHub PR-style diff viewer.
 *
 * Default: side-by-side split view showing the entire file with changed
 * lines highlighted. Press `s` to toggle to a unified (inline) view.
 *
 * Keyboard:
 *   ↑ / k      — previous file
 *   ↓ / j      — next file
 *   s          — toggle split ↔ unified
 *   Esc / ^D   — close
 */
export function DiffView({ payload, onClose }: DiffViewProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const { diffs, stats } = payload;

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "d")) {
      onClose();
    } else if (key.name === "up" || key.name === "k") {
      setSelectedFileIndex((i) => (i > 0 ? i - 1 : diffs.length - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedFileIndex((i) => (i < diffs.length - 1 ? i + 1 : 0));
    } else if (key.name === "s") {
      setViewMode((m) => (m === "split" ? "unified" : "split"));
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

  // selectedFileIndex is always kept within bounds by the keyboard handler,
  // but TypeScript can't prove it — guard defensively.
  const sel = diffs[selectedFileIndex];
  if (!sel) return null;

  const FILE_LIST_W = Math.min(34, Math.floor(width * 0.22));
  // diffPanelWidth = width - file-list - 1-char border on file-list's right side
  const DIFF_W = width - FILE_LIST_W - 1;
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
        <text fg={colors.textMuted}>{`   ↑↓ navigate · s ${isSplit ? "→ unified" : "→ split"} · Esc close`}</text>
      </box>
      <box height={1}><text fg={colors.border}>{rule}</text></box>

      {/* ── Body ── */}
      <box flex={1} flexDirection="row">

        {/* File list panel */}
        <box width={FILE_LIST_W} flexDirection="column" borderRight>
          <scrollbox flex={1}>
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

        {/* Diff panel */}
        <box flex={1} flexDirection="column">
          {/* File path + language */}
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={getStatusColor(sel.status)}>{getStatusIcon(sel.status) + "  "}</text>
            <text fg={colors.text}>{sel.filePath}</text>
            {sel.language ? <text fg={colors.textMuted}>{`  [${sel.language}]`}</text> : null}
          </box>
          <box height={1}><text fg={colors.border}>{hrule(DIFF_W)}</text></box>

          {/* Column labels (split only) */}
          {isSplit && <SplitHeader panelWidth={DIFF_W} />}
          {isSplit && <box height={1}><text fg={colors.border}>{hrule(DIFF_W)}</text></box>}

          {/* Content */}
          <scrollbox flex={1} focused>
            {isSplit
              ? <SplitDiffContent diff={sel} panelWidth={DIFF_W} />
              : <UnifiedDiffContent diff={sel} />
            }
          </scrollbox>
        </box>

      </box>

      {/* ── Footer ── */}
      <box height={1}><text fg={colors.border}>{rule}</text></box>
    </box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Split (side-by-side) view
// ════════════════════════════════════════════════════════════════════════════

// Fixed chars consumed per half-cell before the content starts:
//   4 (line num) + 1 (space) + 1 (gutter) + 1 (space) = 7
const CELL_FIXED = 7;

// ── Data types ──────────────────────────────────────────────────────────────

interface SideCell {
  lineNum: number;
  content: string;
  type: "added" | "removed" | "context";
}

type SideBySideRow =
  | { kind: "hunk"; header: string }
  | { kind: "line"; left?: SideCell; right?: SideCell };

// ── Hunk parsing ─────────────────────────────────────────────────────────────

interface HunkLine {
  type: "added" | "removed" | "context";
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface HunkInfo {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

function parseHunks(unifiedDiff: string): HunkInfo[] {
  const hunks: HunkInfo[] = [];
  let cur: HunkInfo | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of unifiedDiff.split("\n")) {
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) continue;

    if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        if (cur) hunks.push(cur);
        oldLine = parseInt(m[1] ?? "1");
        newLine = parseInt(m[3] ?? "1");
        cur = {
          oldStart: oldLine,
          oldCount: m[2] !== undefined ? parseInt(m[2]) : 1,
          newStart: newLine,
          newCount: m[4] !== undefined ? parseInt(m[4]) : 1,
          lines: [],
        };
      }
      continue;
    }

    if (!cur) continue;

    if (raw.startsWith("+")) {
      cur.lines.push({ type: "added", content: raw.slice(1), newNum: newLine++ });
    } else if (raw.startsWith("-")) {
      cur.lines.push({ type: "removed", content: raw.slice(1), oldNum: oldLine++ });
    } else if (raw.startsWith(" ")) {
      cur.lines.push({ type: "context", content: raw.slice(1), oldNum: oldLine++, newNum: newLine++ });
    }
  }

  if (cur) hunks.push(cur);
  return hunks;
}

// ── Pair removed / added lines within a hunk ─────────────────────────────────

function pairHunkLines(hunkLines: HunkLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;

  while (i < hunkLines.length) {
    // noUncheckedIndexedAccess: assert non-null since we checked i < length
    const line = hunkLines[i]!;

    if (line.type === "context") {
      rows.push({
        kind: "line",
        left:  { lineNum: line.oldNum!, content: line.content, type: "context" },
        right: { lineNum: line.newNum!, content: line.content, type: "context" },
      });
      i++;
      continue;
    }

    // Collect a contiguous change block: all removes, then all adds
    const removed: HunkLine[] = [];
    const added: HunkLine[] = [];
    while (i < hunkLines.length && hunkLines[i]?.type === "removed") removed.push(hunkLines[i++]!);
    while (i < hunkLines.length && hunkLines[i]?.type === "added")   added.push(hunkLines[i++]!);

    const len = Math.max(removed.length, added.length);
    for (let j = 0; j < len; j++) {
      const rem: HunkLine | undefined = removed[j];
      const add: HunkLine | undefined = added[j];
      rows.push({
        kind: "line",
        left:  rem !== undefined ? { lineNum: rem.oldNum!, content: rem.content, type: "removed" } : undefined,
        right: add !== undefined ? { lineNum: add.newNum!, content: add.content, type: "added"   } : undefined,
      });
    }
  }

  return rows;
}

// ── Build the full set of side-by-side rows ──────────────────────────────────

function buildSplitRows(diff: FileDiff): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  const hunks = parseHunks(diff.unifiedDiff);

  if (diff.beforeText !== undefined && diff.afterText !== undefined) {
    // ── Full-file mode: show every line, highlight changed sections ──────────
    const beforeLines = diff.beforeText.split("\n");
    const afterLines  = diff.afterText.split("\n");
    // split() always adds a trailing "" for a newline-terminated file; remove it
    if (beforeLines[beforeLines.length - 1] === "") beforeLines.pop();
    if (afterLines[afterLines.length - 1] === "")   afterLines.pop();

    let oldPos = 1; // 1-indexed current position in beforeLines
    let newPos = 1; // 1-indexed current position in afterLines

    for (const hunk of hunks) {
      // Context lines that precede this hunk
      while (oldPos < hunk.oldStart && oldPos <= beforeLines.length) {
        rows.push({
          kind: "line",
          left:  { lineNum: oldPos, content: beforeLines[oldPos - 1] ?? "", type: "context" },
          right: newPos <= afterLines.length
            ? { lineNum: newPos, content: afterLines[newPos - 1] ?? "", type: "context" }
            : undefined,
        });
        oldPos++;
        newPos++;
      }

      rows.push({
        kind: "hunk",
        header: `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      });
      rows.push(...pairHunkLines(hunk.lines));

      // Advance past this hunk
      oldPos = hunk.oldStart + hunk.oldCount;
      newPos = hunk.newStart + hunk.newCount;
    }

    // Trailing context after the last hunk
    while (oldPos <= beforeLines.length) {
      rows.push({
        kind: "line",
        left:  { lineNum: oldPos, content: beforeLines[oldPos - 1] ?? "", type: "context" },
        right: newPos <= afterLines.length
          ? { lineNum: newPos, content: afterLines[newPos - 1] ?? "", type: "context" }
          : undefined,
      });
      oldPos++;
      newPos++;
    }
  } else {
    // ── Hunk-only mode: server didn't send full file content ─────────────────
    for (const hunk of hunks) {
      rows.push({
        kind: "hunk",
        header: `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      });
      rows.push(...pairHunkLines(hunk.lines));
    }
  }

  return rows;
}

// ── Render components ────────────────────────────────────────────────────────

function SplitHeader({ panelWidth }: { panelWidth: number }) {
  const halfW = Math.floor((panelWidth - 1) / 2);
  const padBefore = Math.max(0, Math.floor((halfW - 6) / 2));
  const padAfter  = Math.max(0, Math.floor(((panelWidth - 1 - halfW) - 5) / 2));
  return (
    <box height={1} flexDirection="row">
      <box width={halfW}>
        <text fg={colors.textMuted}>{" ".repeat(padBefore) + "BEFORE"}</text>
      </box>
      <text fg={colors.border}>{"│"}</text>
      <box flex={1}>
        <text fg={colors.textMuted}>{" ".repeat(padAfter) + "AFTER"}</text>
      </box>
    </box>
  );
}

function SplitDiffContent({ diff, panelWidth }: { diff: FileDiff; panelWidth: number }) {
  const rows    = buildSplitRows(diff);
  const halfW   = Math.floor((panelWidth - 1) / 2);
  const contentW = Math.max(1, halfW - CELL_FIXED);

  return (
    <box flexDirection="column">
      {rows.map((row, i) => {
        if (row.kind === "hunk") {
          return (
            <box key={i} height={1} paddingX={1} flexDirection="row">
              <text fg={colors.accent}>{truncate(row.header, panelWidth - 2)}</text>
            </box>
          );
        }

        const { left, right } = row;
        return (
          <box key={i} height={1} flexDirection="row">
            {/* Left half */}
            <box width={halfW} flexDirection="row">
              <SideCellView cell={left} contentW={contentW} />
            </box>
            {/* Center divider */}
            <text fg={colors.border}>{"│"}</text>
            {/* Right half */}
            <box flex={1} flexDirection="row">
              <SideCellView cell={right} contentW={contentW} />
            </box>
          </box>
        );
      })}
    </box>
  );
}

function SideCellView({ cell, contentW }: { cell?: SideCell; contentW: number }) {
  if (!cell) {
    // Empty slot (e.g. right side of a removed-only line) — dimmed fill
    return <text fg={colors.border}>{" ".repeat(CELL_FIXED + contentW)}</text>;
  }

  const lineNum = String(cell.lineNum).padStart(4);
  let gutter: string;
  let fg: string;

  switch (cell.type) {
    case "added":
      gutter = " + ";
      fg = colors.success;
      break;
    case "removed":
      gutter = " - ";
      fg = colors.error;
      break;
    default:
      gutter = "   ";
      fg = colors.textDim;
  }

  const content = truncate(cell.content, contentW);

  return (
    <box flexDirection="row">
      <text fg={colors.textMuted}>{lineNum}</text>
      <text fg={fg}>{gutter + content}</text>
    </box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Unified view
// ════════════════════════════════════════════════════════════════════════════

type DiffLineType = "added" | "removed" | "context" | "hunk";

interface ParsedDiffLine {
  type: DiffLineType;
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(unifiedDiff: string): ParsedDiffLine[] {
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of unifiedDiff.split("\n")) {
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) continue;

    if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1] ?? "1");
        newLine = parseInt(m[2] ?? "1");
      }
      result.push({ type: "hunk", content: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      result.push({ type: "added",   content: raw.slice(1), newNum: newLine++ });
    } else if (raw.startsWith("-")) {
      result.push({ type: "removed", content: raw.slice(1), oldNum: oldLine++ });
    } else if (raw.startsWith(" ")) {
      result.push({ type: "context", content: raw.slice(1), oldNum: oldLine++, newNum: newLine++ });
    }
  }

  return result;
}

function UnifiedDiffContent({ diff }: { diff: FileDiff }) {
  const lines = parseDiff(diff.unifiedDiff);

  return (
    <box flexDirection="column">
      {lines.map((line, i) => {
        if (line.type === "hunk") {
          return (
            <box key={i} height={1} paddingX={1}>
              <text fg={colors.accent}>{line.content}</text>
            </box>
          );
        }

        const oldNum    = line.oldNum !== undefined ? String(line.oldNum).padStart(4) : "    ";
        const newNum    = line.newNum !== undefined ? String(line.newNum).padStart(4) : "    ";
        let prefix: string;
        let fg: string;
        let gutterFg: string;

        switch (line.type) {
          case "added":
            prefix   = "+";
            fg       = colors.success;
            gutterFg = colors.success;
            break;
          case "removed":
            prefix   = "-";
            fg       = colors.error;
            gutterFg = colors.error;
            break;
          default:
            prefix   = " ";
            fg       = colors.textDim;
            gutterFg = colors.textMuted;
        }

        return (
          <box key={i} height={1} flexDirection="row">
            <text fg={colors.textMuted}>{oldNum + " "}</text>
            <text fg={colors.textMuted}>{newNum + " "}</text>
            <text fg={gutterFg}>{prefix + " "}</text>
            <text fg={fg}>{line.content || " "}</text>
          </box>
        );
      })}
    </box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════════════════════════

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

/** Truncate a string to maxLen chars, appending … if truncated. */
function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}
