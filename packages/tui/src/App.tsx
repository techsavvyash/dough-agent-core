import { useEffect, useState } from "react";
import { DoughClient } from "./client.ts";
import { useSession } from "./hooks/useSession.ts";
import { Header } from "./components/Header.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { colors } from "./theme.ts";

interface AppProps {
  serverUrl: string;
  provider: string;
  model?: string;
}

export function App({ serverUrl, provider, model }: AppProps) {
  const [client] = useState(() => new DoughClient(serverUrl));
  const { messages, isStreaming, session, error, connected, send, abort } =
    useSession(client);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    client
      .connect()
      .then(() => {
        client.createSession(provider, model);
      })
      .catch((err) => {
        setInitError(
          err instanceof Error ? err.message : "Failed to connect"
        );
      });

    return () => client.disconnect();
  }, [client, provider, model]);

  return (
    <box flexDirection="column" height="100%">
      <Header session={session} connected={connected} />

      <scrollbox flex={1} focused={false}>
        {initError ? (
          <box paddingX={2} flexDirection="column" gap={1}>
            <text fg={colors.error}>Connection error: {initError}</text>
            <text fg={colors.textDim}>
              Start the server: bun run --filter @dough/server start
            </text>
          </box>
        ) : (
          <ChatView messages={messages} />
        )}
      </scrollbox>

      {error && (
        <box paddingX={2}>
          <text fg={colors.error}>{error}</text>
        </box>
      )}

      <InputBar onSubmit={send} isStreaming={isStreaming} onAbort={abort} />
    </box>
  );
}
