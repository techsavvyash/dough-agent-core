import { useState, useEffect, useCallback } from "react";
import type { ThreadMeta } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

export function useThreads(client: DoughClient) {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);

  useEffect(() => {
    const unsub = client.onThreads((list: ThreadMeta[]) => {
      setThreads(list);
    });
    return unsub;
  }, [client]);

  const requestThreads = useCallback(
    (sessionId: string) => {
      client.listThreads(sessionId);
    },
    [client]
  );

  return { threads, requestThreads };
}
