import { useState, useEffect, useCallback } from "react";
import type { SessionMeta } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

export function useSessions(client: DoughClient) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  useEffect(() => {
    return client.onSessions((s) => {
      setSessions(s);
    });
  }, [client]);

  const requestSessions = useCallback(() => {
    client.listSessions();
  }, [client]);

  return { sessions, requestSessions };
}
