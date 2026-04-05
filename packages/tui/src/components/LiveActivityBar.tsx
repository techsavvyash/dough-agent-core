import { useState, useEffect } from "react";
import type { Message } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

interface LiveActivityBarProps {
  messages: Message[];
}

/**
 * Persistent animated status bar shown while the agent is working.
 *
 * Always visible during streaming — unlike ThinkingIndicator which only
 * shows before the first assistant message, this component stays anchored
 * below the last message for the entire turn and adapts its label to the
 * current phase:
 *
 *   ⏺ ⠙ Thinking...  12s          ← reasoning phase
 *   ⏺ ⠙ Running  git status        ← tool executing
 *   ⏺ ⠙ Writing response...        ← content delta streaming
 *   ⏺ ⠙ Working...                 ← fallback / between phases
 */
export function LiveActivityBar({ messages }: LiveActivityBarProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const spinInterval = setInterval(
      () => setFrame((f) => (f + 1) % symbols.spinnerFrames.length),
      80,
    );
    const tickInterval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(spinInterval);
      clearInterval(tickInterval);
    };
  }, []);

  const spinner = symbols.spinnerFrames[frame] ?? symbols.spinnerFrames[0]!;

  // Derive current phase from message state
  const streamingMsg = [...messages].reverse().find((m) => m.isStreaming);
  const pendingTool = streamingMsg?.toolCalls
    ?.find((tc) => tc.status === "pending");

  let phase: "thinking" | "tool" | "writing" | "working" = "working";
  let phaseLabel = "Working...";
  let phaseColor: string = colors.textDim;

  if (pendingTool) {
    phase = "tool";
    const isBash =
      pendingTool.name === "Bash" ||
      pendingTool.name === "bash" ||
      pendingTool.name === "execute" ||
      pendingTool.name === "command_execution";
    const cmd = isBash && pendingTool.args.command
      ? String(pendingTool.args.command).split("\n")[0]?.slice(0, 60) ?? ""
      : "";
    phaseLabel = cmd
      ? `Running  ${cmd}`
      : `Running  ${pendingTool.name}`;
    phaseColor = colors.warning;
  } else if (streamingMsg?.content && streamingMsg.content.length > 0) {
    phase = "writing";
    phaseLabel = "Writing response...";
    phaseColor = colors.accent;
  } else if (streamingMsg?.thought) {
    phase = "thinking";
    const elapsedStr = elapsed > 0 ? `  ${String(elapsed)}s` : "";
    phaseLabel = `Thinking...${elapsedStr}`;
    phaseColor = colors.primary;
  }

  // Suppress "unused variable" warning while keeping the phase derivation
  // logic readable — phase is used below for conditional rendering.
  void phase;

  return (
    <box height={1} paddingX={1} flexDirection="row">
      {/* assistant prefix — same column as real assistant messages */}
      <box width={2} flexShrink={0}>
        <text fg={colors.primary}>{symbols.assistantPrefix}</text>
      </box>
      {/* animated spinner */}
      <box width={2} flexShrink={0}>
        <text fg={phaseColor}>{spinner}</text>
      </box>
      {/* phase label */}
      <text fg={phaseColor}>{phaseLabel}</text>
    </box>
  );
}
