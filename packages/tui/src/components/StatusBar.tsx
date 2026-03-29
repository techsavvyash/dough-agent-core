import { colors } from "../theme.ts";

export type ApprovalMode = "auto" | "plan" | "confirm";

interface StatusBarProps {
  model: string;
  provider: string;
  totalTokens: number;
  threadCount: number;
  gitBranch: string;
  approvalMode: ApprovalMode;
  themeName: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const APPROVAL_COLORS: Record<ApprovalMode, string> = {
  auto: "#A6E22E",     // green — agent acts freely
  plan: "#FFFFAF",     // yellow — shows plan, waits for ok
  confirm: "#FF87AF",  // red — confirms every tool call
};

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  auto: "AUTO",
  plan: "PLAN",
  confirm: "CONFIRM",
};

export function StatusBar({
  model, provider, totalTokens, threadCount, gitBranch, approvalMode, themeName,
}: StatusBarProps) {
  const modelLabel = model ? `${provider} · ${model}` : provider;
  const modeColor = APPROVAL_COLORS[approvalMode];
  const modeLabel = APPROVAL_LABELS[approvalMode];

  return (
    <box height={1} flexDirection="row" paddingX={1}>
      {/* Left side: git branch + model */}
      <box flexDirection="row" flex={1}>
        {gitBranch ? (
          <box flexDirection="row" marginRight={2}>
            <text fg={colors.accent}>{"⎇ "}</text>
            <text fg={colors.textDim}>{gitBranch}</text>
          </box>
        ) : null}
        <text fg={colors.textMuted}>{modelLabel}</text>
      </box>

      {/* Right side: approval mode + theme + threads + token usage */}
      <box flexDirection="row">
        <box flexDirection="row" marginRight={2}>
          <text fg={modeColor}>{`[${modeLabel}]`}</text>
        </box>
        {themeName !== "default" ? (
          <box flexDirection="row" marginRight={2}>
            <text fg={colors.textMuted}>{`theme:${themeName}`}</text>
          </box>
        ) : null}
        {threadCount > 1 ? (
          <box flexDirection="row" marginRight={2}>
            <text fg={colors.textMuted}>{"threads "}</text>
            <text fg={colors.textDim}>{String(threadCount)}</text>
          </box>
        ) : null}
        {totalTokens > 0 ? (
          <box flexDirection="row">
            <text fg={colors.textMuted}>{"tokens "}</text>
            <text fg={colors.primary}>{formatTokens(totalTokens)}</text>
          </box>
        ) : null}
      </box>
    </box>
  );
}
