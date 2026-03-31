"use client";

import { useWakeStatus } from "@/lib/use-wake-status";

/**
 * Small green pulsing dot shown next to character names in the sidebar
 * when the AutonomousScheduler is running for that character.
 */
export function WakeIndicator({ slug }: { slug: string }) {
  const { isAwake, isLoading } = useWakeStatus(slug);

  if (isLoading || !isAwake) {
    return null;
  }

  return (
    <span className="relative flex h-2 w-2 shrink-0" title="Awake">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}
