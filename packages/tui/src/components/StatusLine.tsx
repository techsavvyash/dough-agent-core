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
  const parts = [
    `${symbols.dot} ${stats.filesChanged} ${fileLabel} changed`,
    `+${stats.totalAdded}`,
    `-${stats.totalRemoved}`,
  ];
  if (diffModeHint) parts.push(` ${diffModeHint}`);
  const statusText = parts.join(" ");

  return (
    <box height={1} paddingX={2}>
      <text fg={colors.textMuted}>{statusText}</text>
    </box>
  );
}
