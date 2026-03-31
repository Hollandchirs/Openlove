"use client";

import { Power, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWakeStatus } from "@/lib/use-wake-status";

interface WakeButtonProps {
  slug: string;
  /** Compact mode for sidebar/inline use */
  compact?: boolean;
}

/**
 * Wake/Sleep toggle button for starting/stopping the AutonomousScheduler.
 * Shows green when running, gray when stopped, with a loading spinner during transitions.
 */
export function WakeButton({ slug, compact = false }: WakeButtonProps) {
  const { isAwake, isLoading, transitioning, wake, sleep } =
    useWakeStatus(slug);

  const handleClick = () => {
    if (transitioning || isLoading) return;
    if (isAwake) {
      sleep();
    } else {
      wake();
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={transitioning || isLoading}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
          isAwake
            ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
            : "bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]/80 hover:text-[hsl(var(--foreground))]"
        )}
        title={isAwake ? "Disable browser" : "Enable browser"}
      >
        {transitioning || isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Power className="h-3.5 w-3.5" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={transitioning || isLoading}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
        isAwake
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
          : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/30 hover:text-[hsl(var(--foreground))]"
      )}
    >
      {transitioning || isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Power className="h-3.5 w-3.5" />
      )}
      <span>{isAwake ? "Browser On" : "Browser"}</span>
      {isAwake && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      )}
    </button>
  );
}
