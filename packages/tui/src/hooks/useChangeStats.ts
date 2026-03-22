import { useState, useEffect, useCallback } from "react";
import { DoughEventType } from "@dough/protocol";
import type { ChangeStats, DiffPayload, DoughEvent } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

const EMPTY_STATS: ChangeStats = {
  filesChanged: 0,
  totalAdded: 0,
  totalRemoved: 0,
  files: [],
};

export function useChangeStats(client: DoughClient) {
  const [stats, setStats] = useState<ChangeStats>(EMPTY_STATS);
  const [diffPayload, setDiffPayload] = useState<DiffPayload | null>(null);

  useEffect(() => {
    const unsubEvent = client.onEvent((event: DoughEvent) => {
      if (event.type === DoughEventType.ChangeStatsUpdate) {
        setStats(event.stats);
      }
    });

    const unsubDiffs = client.onDiffs((payload: DiffPayload) => {
      setDiffPayload(payload);
    });

    return () => {
      unsubEvent();
      unsubDiffs();
    };
  }, [client]);

  const requestDiffs = useCallback(() => {
    client.getDiffs();
  }, [client]);

  const clearDiffs = useCallback(() => {
    setDiffPayload(null);
  }, []);

  return {
    stats,
    diffPayload,
    requestDiffs,
    clearDiffs,
    hasChanges: stats.filesChanged > 0,
  };
}
