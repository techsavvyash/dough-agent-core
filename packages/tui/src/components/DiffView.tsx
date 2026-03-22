import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { DiffPayload, FileDiff } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";

interface DiffViewProps {
  payload: DiffPayload;
  onClose: () => void;
}

/**
 * GitHub PR changes-style diff viewer.
 * Left panel: file list with change indicators.
 * Right panel: unified diff for the selected file.
 */
export function DiffView({ payload, onClose }: DiffViewProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const { diffs, stats } = payload;

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "d")) {
      onClose();
    } else if (key.name === "up" || key.name === "k") {
      setSelectedFileIndex((i) => (i > 0 ? i - 1 : diffs.length - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedFileIndex((i) => (i < diffs.length - 1 ? i + 1 : 0));
    }
  });

  if (diffs.length === 0) {
    return (
      <box flexDirection="column" height="100%">
        <box height={1}>
          <text fg={colors.border}>{hrule(width)}</text>
        </box>
        <box paddingX={2} flex={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>No file changes in this session.</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>Press Esc to close</text>
        </box>
      </box>
    );
  }

  const selectedDiff = diffs[selectedFileIndex];
  const fileListWidth = Math.min(40, Math.floor(width * 0.3));
  const rule = hrule(width);

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={colors.primary}>{"Changes "}</text>
        <text fg={colors.accent}>{`${stats.filesChanged} files `}</text>
        <text fg={colors.success}>{`+${stats.totalAdded} `}</text>
        <text fg={colors.error}>{`-${stats.totalRemoved} `}</text>
        <text fg={colors.textMuted}>{"  (↑↓/jk navigate, Esc close)"}</text>
      </box>
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Main content: file list + diff */}
      <box flex={1} flexDirection="row">
        {/* File list panel */}
        <box width={fileListWidth} flexDirection="column" borderRight>
          <scrollbox flex={1}>
            {diffs.map((diff, i) => {
              const isSelected = i === selectedFileIndex;
              const statusIcon = getStatusIcon(diff.status);
              const statusColor = getStatusColor(diff.status);
              const fileName = shortenPath(diff.filePath);
              const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";

              return (
                <box key={diff.filePath} height={1} flexDirection="row">
                  <text fg={colors.accent}>{indicator}</text>
                  <text fg={statusColor}>{statusIcon} </text>
                  <text fg={isSelected ? colors.text : colors.textDim}>
                    {fileName}
                  </text>
                  <text fg={colors.textMuted}>
                    {` +${diff.linesAdded} -${diff.linesRemoved}`}
                  </text>
                </box>
              );
            })}
          </scrollbox>
        </box>

        {/* Diff panel */}
        <box flex={1} flexDirection="column">
          {/* File header */}
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={getStatusColor(selectedDiff.status)}>
              {getStatusIcon(selectedDiff.status)}{" "}
            </text>
            <text fg={colors.text}>{selectedDiff.filePath}</text>
          </box>
          <box height={1}>
            <text fg={colors.border}>{hrule(width - fileListWidth)}</text>
          </box>

          {/* Diff content */}
          <scrollbox flex={1} focused>
            <DiffContent diff={selectedDiff} />
          </scrollbox>
        </box>
      </box>

      {/* Footer */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
    </box>
  );
}

// ── Diff parser ──────────────────────────────────────────────────────────────

type DiffLineType = "added" | "removed" | "context" | "hunk";

interface ParsedDiffLine {
  type: DiffLineType;
  content: string;
  /** Line number in the original file (undefined for added lines) */
  oldNum?: number;
  /** Line number in the new file (undefined for removed lines) */
  newNum?: number;
}

/**
 * Parse a unified diff string into structured lines with line numbers.
 * Skips file-level metadata headers (diff/index/---/+++) since the
 * filename is already shown in the panel header above.
 */
function parseDiff(unifiedDiff: string): ParsedDiffLine[] {
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of unifiedDiff.split("\n")) {
    // Skip file-level header noise — shown in the panel header already
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) continue;

    if (raw.startsWith("@@")) {
      // @@ -oldStart[,count] +newStart[,count] @@ [optional context]
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      result.push({ type: "hunk", content: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      result.push({ type: "added", content: raw.slice(1), newNum: newLine++ });
    } else if (raw.startsWith("-")) {
      result.push({ type: "removed", content: raw.slice(1), oldNum: oldLine++ });
    } else if (raw.startsWith(" ")) {
      result.push({ type: "context", content: raw.slice(1), oldNum: oldLine++, newNum: newLine++ });
    }
    // trailing empty lines / no-newline markers → skip
  }

  return result;
}

// ── DiffContent renderer ─────────────────────────────────────────────────────

/** GitHub PR-style diff renderer with line numbers and a +/- gutter. */
function DiffContent({ diff }: { diff: FileDiff }) {
  const lines = parseDiff(diff.unifiedDiff);

  return (
    <box flexDirection="column">
      {lines.map((line, i) => {
        if (line.type === "hunk") {
          // Hunk header — show as a styled separator with the @@ context
          return (
            <box key={`h${i}`} height={1} flexDirection="row" paddingX={1}>
              <text fg={colors.secondary}>{line.content}</text>
            </box>
          );
        }

        const oldNum =
          line.oldNum !== undefined ? String(line.oldNum).padStart(4) : "    ";
        const newNum =
          line.newNum !== undefined ? String(line.newNum).padStart(4) : "    ";

        let prefix: string;
        let lineFg: string;
        let gutterFg: string;

        switch (line.type) {
          case "added":
            prefix = "+";
            lineFg = colors.success;
            gutterFg = colors.success;
            break;
          case "removed":
            prefix = "-";
            lineFg = colors.error;
            gutterFg = colors.error;
            break;
          default:
            prefix = " ";
            lineFg = colors.text;
            gutterFg = colors.textMuted;
        }

        return (
          <box key={`l${i}`} height={1} flexDirection="row">
            {/* Old line number */}
            <text fg={colors.textMuted}>{oldNum} </text>
            {/* New line number */}
            <text fg={colors.textMuted}>{newNum} </text>
            {/* +/- gutter */}
            <text fg={gutterFg}>{prefix} </text>
            {/* Line content */}
            <text fg={lineFg}>{line.content || " "}</text>
          </box>
        );
      })}
    </box>
  );
}

function getStatusIcon(status: FileDiff["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
  }
}

function getStatusColor(status: FileDiff["status"]): string {
  switch (status) {
    case "added":
      return colors.success;
    case "modified":
      return colors.accent;
    case "deleted":
      return colors.error;
  }
}

/** Shorten a file path to just the last 2-3 segments */
function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return ".../" + parts.slice(-3).join("/");
}
