import { useState, useEffect } from "react";
import type { RuntimeShortcutMeta, RuntimeCommandMeta, RuntimePanelMeta } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

/**
 * Hook that subscribes to runtime contributions (shortcuts, commands, panels)
 * from the server. The server sends these on connection open and whenever
 * they change.
 */
export function useRuntimeContributions(client: DoughClient) {
  const [shortcuts, setShortcuts] = useState<RuntimeShortcutMeta[]>([]);
  const [commands, setCommands] = useState<RuntimeCommandMeta[]>([]);
  const [panels, setPanels] = useState<RuntimePanelMeta[]>([]);

  useEffect(() => {
    const unsubs = [
      client.onShortcuts(setShortcuts),
      client.onCommands(setCommands),
      client.onPanels(setPanels),
      // Server sends contributions on ws open, but React effects run after
      // the first render — by then the messages are already delivered and lost.
      // Re-request once connected so the server resends them.
      client.onConnect(() => {
        client.requestContributions();
      }),
    ];
    // Also request immediately if already connected (reconnect scenario)
    if (client.connected) {
      client.requestContributions();
    }
    return () => unsubs.forEach((u) => u());
  }, [client]);

  return { shortcuts, commands, panels };
}
