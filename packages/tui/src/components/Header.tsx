import type { SessionMeta } from "@dough/protocol";
import { colors } from "../theme.ts";

interface HeaderProps {
  session: SessionMeta | null;
  connected: boolean;
}

// Braille art derived from ~/Documents/Dough/logo.svg
const logo = [
  "⠀⠀⢀⣀⣀⣀⣠⣶⣿⣷⣦⠀",
  "⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀",
  "⠀⣰⣿⣿⣿⣿⣿⣿⣿⣿⣏⠀",
  "⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆",
  "⠘⠻⠿⠿⣿⣿⣿⣿⣿⣿⣿⡟",
  "⠀⠀⠀⠀⠀⠉⠻⢿⣿⠿⠟⠁",
];

export function Header({ session, connected }: HeaderProps) {
  const provider = session?.provider ?? "claude";
  const model = session?.model ?? "";
  const cwd = process.cwd().replace(process.env.HOME ?? "", "~");

  const status = connected ? "connected" : "disconnected";
  const statusColor = connected ? colors.success : colors.error;
  const infoLine = provider + (model ? ` · ${model}` : "");

  return (
    <box flexDirection="column" paddingX={1} height={8}>
      <box flexDirection="row" marginTop={1}>
        <box flexDirection="column" width={13}>
          {logo.map((line, i) => (
            <box key={i} height={1}>
              <text fg={colors.logo}>{line}</text>
            </box>
          ))}
        </box>
        <box flexDirection="column" paddingLeft={2}>
          <box height={1} flexDirection="row">
            <text fg={colors.primary}>{"Dough "}</text>
            <text fg={colors.textDim}>{"v0.1.0"}</text>
          </box>
          <box height={1}>
            <text fg={colors.accent}>{infoLine}</text>
          </box>
          <box height={1}>
            <text fg={colors.textMuted}>{cwd}</text>
          </box>
          <box height={1} flexDirection="row">
            <text fg={statusColor}>{"● "}</text>
            <text fg={colors.textDim}>{status}</text>
          </box>
        </box>
      </box>
    </box>
  );
}
