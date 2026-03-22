import { useState, useCallback } from "react";
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

/** Render the unified diff with colored +/- lines */
function DiffContent({ diff }: { diff: FileDiff }) {
  const lines = diff.unifiedDiff.split("\n");

  return (
    <box flexDirection="column" paddingX={1}>
      {lines.map((line, i) => {
        let fg = colors.textDim;
        if (line.startsWith("+") && !line.startsWith("+++")) {
          fg = colors.success;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          fg = colors.error;
        } else if (line.startsWith("@@")) {
          fg = colors.secondary;
        } else if (line.startsWith("diff") || line.startsWith("index")) {
          fg = colors.textMuted;
        }

        return (
          <box key={`${i}`} height={1}>
            <text fg={fg}>{line || " "}</text>
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
