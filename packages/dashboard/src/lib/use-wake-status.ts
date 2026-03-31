"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BridgePlatform = "discord" | "telegram" | "whatsapp";

export interface WakeStatus {
  status: "running" | "stopped" | "loading";
  startedAt: number | null;
  bridges: BridgePlatform[];
}

const POLL_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Hook that polls the wake API for a character's scheduler status.
 * Provides wake() and sleep() functions to start/stop the scheduler.
 */
export function useWakeStatus(slug: string) {
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>({
    status: "loading",
    startedAt: null,
    bridges: [],
  });
  const [transitioning, setTransitioning] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`/api/wake/${slug}`);
      if (resp.ok) {
        const data = await resp.json();
        setWakeStatus({
          status: data.status === "running" ? "running" : "stopped",
          startedAt: data.startedAt ?? null,
          bridges: data.bridges ?? [],
        });
      }
    } catch {
      // Non-critical — keep last known state
    }
  }, [slug]);

  useEffect(() => {
    setWakeStatus({ status: "loading", startedAt: null, bridges: [] });
    fetchStatus();

    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchStatus]);

  const wake = useCallback(async () => {
    setTransitioning(true);
    try {
      const resp = await fetch(`/api/wake/${slug}`, { method: "POST" });
      if (resp.ok) {
        const data = await resp.json();
        setWakeStatus({
          status: "running",
          startedAt: data.startedAt ?? Date.now(),
          bridges: data.bridges ?? [],
        });
      }
    } catch {
      // Will recover on next poll
    } finally {
      setTransitioning(false);
    }
  }, [slug]);

  const sleep = useCallback(async () => {
    setTransitioning(true);
    try {
      const resp = await fetch(`/api/wake/${slug}`, { method: "DELETE" });
      if (resp.ok) {
        setWakeStatus({ status: "stopped", startedAt: null, bridges: [] });
      }
    } catch {
      // Will recover on next poll
    } finally {
      setTransitioning(false);
    }
  }, [slug]);

  const isAwake = wakeStatus.status === "running";
  const isLoading = wakeStatus.status === "loading";

  return { wakeStatus, isAwake, isLoading, transitioning, wake, sleep };
}
