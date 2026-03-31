"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ActivityData {
  status: "active" | "idle" | "offline";
  activity: {
    type: string;
    title: string;
    description: string;
    icon: string;
    metadata: Record<string, unknown> | null;
  } | null;
  lastSeen: number | null;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Returns true if the activity title refers to an internal proactive-message
 * event that should never be shown to users. Defence-in-depth — the API
 * already filters these, but we guard on the client too.
 */
function isInternalActivity(activity: ActivityData["activity"]): boolean {
  if (!activity) return false;
  const lower = activity.title.toLowerCase();
  return lower.includes("proactive message") || lower.includes("proactive_message");
}

/**
 * Hook that polls the activity API for a character's current status.
 * Returns activity data and a loading state.
 */
export function useActivity(slug: string): {
  activity: ActivityData | null;
  loading: boolean;
} {
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      const resp = await fetch(`/api/activity/${slug}`);
      if (resp.ok) {
        const data: ActivityData = await resp.json();
        // Strip internal proactive-message activities from user-facing display
        const sanitized: ActivityData = isInternalActivity(data.activity)
          ? { ...data, activity: null }
          : data;
        setActivity(sanitized);
      }
    } catch {
      // Silently fail — activity is non-critical
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    setActivity(null);
    fetchActivity();

    intervalRef.current = setInterval(fetchActivity, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchActivity]);

  return { activity, loading };
}

/** Map activity icon name to emoji for lightweight inline display */
export function activityIconEmoji(icon: string): string {
  switch (icon) {
    case "music":    return "\uD83C\uDFB5";
    case "tv":       return "\uD83D\uDCFA";
    case "youtube":  return "\u25B6\uFE0F";
    case "globe":    return "\uD83C\uDF10";
    case "share":    return "\uD83D\uDCE2";
    case "sparkles": return "\u2728";
    case "message":  return "\uD83D\uDCAC";
    default:         return "\uD83D\uDCA0";
  }
}

/** Format "last seen" as a human-readable relative time */
export function formatLastSeen(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
