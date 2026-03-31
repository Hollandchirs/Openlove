"use client";

import { useActivity, activityIconEmoji, formatLastSeen } from "@/lib/use-activity";
import { useWakeStatus } from "@/lib/use-wake-status";
import { cn } from "@/lib/utils";

interface ActivityStatusBarProps {
  slug: string;
  /** When true, the character is shown as "Online" regardless of wake status. */
  isChatActive?: boolean;
}

/**
 * Live activity status bar shown below the character name in the chat header.
 * Shows what the character is currently doing (music, drama, browsing, etc.)
 * with a green/gray dot indicating active vs. offline.
 */
export function ActivityStatusBar({ slug, isChatActive = false }: ActivityStatusBarProps) {
  const { activity, loading } = useActivity(slug);
  const { isAwake } = useWakeStatus(slug);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-500" />
        <span className="animate-pulse">Loading...</span>
      </div>
    );
  }

  const isActive = activity?.status === "active";
  const isOnline = isActive || isAwake || isChatActive;

  // Online with an active activity — show what they're doing
  if (isOnline && activity?.activity) {
    const emoji = activityIconEmoji(activity.activity.icon);
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="truncate text-[hsl(var(--muted-foreground))]">
          <span className="font-medium text-emerald-400">Online</span>
          {" — "}
          <span>{emoji}</span>{" "}
          <span className="font-medium text-[hsl(var(--foreground))]/80">
            {activity.activity.title}
          </span>
        </span>
      </div>
    );
  }

  // Online but no specific activity yet
  if (isOnline) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="font-medium text-emerald-400">Online</span>
      </div>
    );
  }

  // Not awake, no activity data
  if (!activity) {
    return (
      <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        <span className="h-2 w-2 rounded-full bg-zinc-500" />
        <span>Offline</span>
      </div>
    );
  }

  // Not awake but has recent activity data
  if (isActive && activity.activity) {
    const emoji = activityIconEmoji(activity.activity.icon);
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="truncate text-[hsl(var(--muted-foreground))]">
          <span>{emoji}</span>{" "}
          <span className="font-medium text-[hsl(var(--foreground))]/80">
            {activity.activity.title}
          </span>
        </span>
      </div>
    );
  }

  // Offline — show last seen
  return (
    <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
      <span className="h-2 w-2 rounded-full bg-zinc-500" />
      <span>
        Last seen {formatLastSeen(activity.lastSeen)}
        {activity.activity && (
          <>
            {" "}&middot; {activityIconEmoji(activity.activity.icon)} {activity.activity.title}
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Compact activity indicator for sidebar character list.
 * Shows a small icon next to the character name.
 */
export function ActivityIndicator({ slug }: { slug: string }) {
  const { activity } = useActivity(slug);

  if (!activity?.activity || activity.status !== "active") {
    return null;
  }

  const emoji = activityIconEmoji(activity.activity.icon);

  return (
    <span
      className="shrink-0 text-[11px] opacity-70"
      title={activity.activity.title}
    >
      {emoji}
    </span>
  );
}

/**
 * Activity display for the character status sidebar panel.
 * Shows the current activity with icon, or "last seen" if offline.
 */
export function ActivityStatusPanel({
  slug,
  isChatActive = false,
}: {
  slug: string;
  /** When true, the character is shown as "Online" regardless of wake status. */
  isChatActive?: boolean;
}) {
  const { activity, loading } = useActivity(slug);
  const { isAwake } = useWakeStatus(slug);

  if (loading) {
    return (
      <div className="h-10 animate-pulse rounded bg-[hsl(var(--secondary))]" />
    );
  }

  if (!activity && !isAwake && !isChatActive) {
    return null;
  }

  const isActive = activity?.status === "active";
  const showOnline = isActive || isAwake || isChatActive;

  return (
    <div className="space-y-2">
      {/* Status dot + label */}
      <div className="flex items-center gap-2">
        {showOnline ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />
        )}
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          {showOnline ? "Online" : "Offline"}
        </span>
        {!showOnline && activity?.lastSeen && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            &middot; {formatLastSeen(activity.lastSeen)}
          </span>
        )}
      </div>

      {/* Current activity */}
      {activity?.activity && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2",
            showOnline
              ? "bg-emerald-500/10 border border-emerald-500/20"
              : "bg-[hsl(var(--secondary))]"
          )}
        >
          <span className="mt-0.5 text-sm">
            {activityIconEmoji(activity.activity.icon)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-xs font-medium",
                showOnline
                  ? "text-emerald-300"
                  : "text-[hsl(var(--muted-foreground))]"
              )}
            >
              {activity.activity.title}
            </p>
            {activity.activity.description && (
              <p className="mt-0.5 truncate text-[10px] text-[hsl(var(--muted-foreground))]/70">
                {activity.activity.description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
