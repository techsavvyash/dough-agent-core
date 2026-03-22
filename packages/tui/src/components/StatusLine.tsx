import type { ChangeStats } from "@dough/protocol";
import { colors, symbols } from "../theme.ts";

interface StatusLineProps {
  stats: ChangeStats;
  diffModeHint: string;
}

export function StatusLine({ stats, diffModeHint }: StatusLineProps) {
  if (stats.filesChanged === 0) {
    return null;
  }

  const fileLabel = stats.filesChanged === 1 ? "file" : "files";
  const statsText = `${stats.filesChanged} ${fileLabel} changed`;
  const addedText = `+${stats.totalAdded}`;
  const removedText = `-${stats.totalRemoved}`;

  return (
    <box height={1} paddingX={2} flexDirection="row" gap={1}>
      <text fg={colors.textMuted}>{symbols.dot} </text>
      <text fg={colors.accent}>{statsText}</text>
      <text fg={colors.success}>{addedText}</text>
      <text fg={colors.error}>{removedText}</text>
      <text fg={colors.textMuted}>{`  ${diffModeHint}`}</text>
    </box>
  );
}
