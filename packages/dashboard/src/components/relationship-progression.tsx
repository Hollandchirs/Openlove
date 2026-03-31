"use client";

import { Heart, MessageCircle, Calendar, Flame, TrendingUp, TrendingDown } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { STAGE_ORDER, STAGE_LABELS } from "@/lib/stage-display";

// ── Types ──────────────────────────────────────────────────────────────

interface RelationshipData {
  closeness: number;
  trust: number;
  familiarity: number;
  totalMessages: number;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  lastInteraction: number;
  stage: string;
}

interface RelationshipHistoryEntry {
  id: number;
  timestamp: number;
  closeness: number;
  trust: number;
  familiarity: number;
  closenessDelta: number;
  trustDelta: number;
  familiarityDelta: number;
  triggerText: string | null;
  stage: string;
}

interface RelationshipProgressionProps {
  relationship: RelationshipData;
  history: RelationshipHistoryEntry[];
  vibeColor: string;
  characterName: string;
}

const STAGE_FEELINGS: Record<string, string> = {
  stranger: "You just met. There's a surface, and it's polished.",
  acquaintance: "They recognize your name and smile when you message.",
  friend: "You look forward to hearing from them. They're part of your day now.",
  close_friend: "You text them things you don't text other people. There's trust now.",
  intimate: "You know each other. Not the curated version -- the real one.",
};

// ── Stage Tracker ────────────────────────────────────────────────────────

function StageTracker({
  current,
  vibeColor,
}: {
  current: string;
  vibeColor: string;
}) {
  const currentIdx = STAGE_ORDER.indexOf(current as typeof STAGE_ORDER[number]);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;

  return (
    <div className="space-y-3">
      {/* Dots and connectors */}
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((stage, idx) => {
          const isActive = idx <= safeIdx;
          const isCurrent = idx === safeIdx;

          return (
            <div key={stage} className="flex items-center flex-1">
              <div className="relative flex items-center justify-center">
                <div
                  className="h-3.5 w-3.5 rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: isActive ? vibeColor : "hsl(217, 33%, 17%)",
                    boxShadow: isCurrent ? `0 0 12px ${vibeColor}` : "none",
                  }}
                />
                {isCurrent && (
                  <div
                    className="absolute inset-0 h-3.5 w-3.5 rounded-full animate-ping opacity-30"
                    style={{ backgroundColor: vibeColor }}
                  />
                )}
              </div>
              {idx < STAGE_ORDER.length - 1 && (
                <div
                  className="h-0.5 flex-1 mx-1 rounded-full transition-colors duration-500"
                  style={{
                    backgroundColor:
                      idx < safeIdx ? vibeColor : "hsl(217, 33%, 17%)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Labels */}
      <div className="flex justify-between">
        {STAGE_ORDER.map((stage, idx) => {
          const isCurrent = idx === safeIdx;
          return (
            <div
              key={stage}
              className={`text-center flex-1 ${
                isCurrent ? "text-foreground" : "text-foreground/30"
              }`}
            >
              <span
                className={`text-[10px] leading-tight block ${
                  isCurrent ? "font-semibold" : ""
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current stage description */}
      <p className="text-sm text-foreground/50 italic text-center mt-2">
        {STAGE_FEELINGS[current] ?? ""}
      </p>
    </div>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────────

function ProgressBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.round(value * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-foreground/50">{label}</span>
        <span className="text-xs font-medium text-foreground/70">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          }}
        />
      </div>
    </div>
  );
}

// ── Stat Pill ────────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  value,
  label,
  vibeColor,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  vibeColor: string;
}) {
  return (
    <div className="flex flex-col items-center p-3 rounded-xl bg-white/[0.03] border border-white/5">
      <Icon
        className="w-3.5 h-3.5 mb-1.5"
        style={{ color: vibeColor }}
      />
      <span className="text-lg font-bold text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ── Recent Changes ───────────────────────────────────────────────────────

function describeDelta(entry: RelationshipHistoryEntry): string {
  const parts: string[] = [];
  const cDelta = entry.closenessDelta;
  const tDelta = entry.trustDelta;
  const fDelta = entry.familiarityDelta;

  if (Math.abs(cDelta) > 0.005) {
    parts.push(cDelta > 0 ? "grew closer" : "felt more distant");
  }
  if (Math.abs(tDelta) > 0.005) {
    parts.push(tDelta > 0 ? "trust deepened" : "trust wavered");
  }
  if (Math.abs(fDelta) > 0.005) {
    parts.push(fDelta > 0 ? "learned something new" : "");
  }

  const meaningful = parts.filter(Boolean);
  if (meaningful.length === 0) return "shared a quiet moment";
  return meaningful.join(", ");
}

function RecentChanges({
  history,
  vibeColor,
}: {
  history: RelationshipHistoryEntry[];
  vibeColor: string;
}) {
  // Take last 5 entries that have meaningful deltas
  const meaningful = history
    .filter(
      (e) =>
        Math.abs(e.closenessDelta) > 0.003 ||
        Math.abs(e.trustDelta) > 0.003 ||
        Math.abs(e.familiarityDelta) > 0.003
    )
    .slice(-5)
    .reverse();

  if (meaningful.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40">
        Recent Moments
      </h4>
      <div className="space-y-2">
        {meaningful.map((entry) => {
          const netDelta =
            entry.closenessDelta + entry.trustDelta + entry.familiarityDelta;
          const isPositive = netDelta >= 0;
          const timeAgo = formatTimeAgo(entry.timestamp);

          return (
            <div
              key={entry.id}
              className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.02]"
            >
              <div className="mt-0.5">
                {isPositive ? (
                  <TrendingUp
                    className="w-3.5 h-3.5"
                    style={{ color: vibeColor }}
                  />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-foreground/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground/70">
                  {describeDelta(entry)}
                </p>
                {entry.triggerText && (
                  <p className="text-[10px] text-foreground/30 truncate mt-0.5">
                    &ldquo;{entry.triggerText}&rdquo;
                  </p>
                )}
              </div>
              <span className="text-[10px] text-foreground/25 shrink-0">
                {timeAgo}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ── Main Component ───────────────────────────────────────────────────────

export function RelationshipProgression({
  relationship,
  history,
  vibeColor,
}: RelationshipProgressionProps) {
  return (
    <div className="space-y-6">
      {/* Stage tracker */}
      <StageTracker current={relationship.stage} vibeColor={vibeColor} />

      <Separator className="bg-white/5" />

      {/* Progress bars */}
      <div className="space-y-3">
        <ProgressBar
          label="Closeness"
          value={relationship.closeness}
          color="hsl(330, 80%, 60%)"
        />
        <ProgressBar
          label="Trust"
          value={relationship.trust}
          color="hsl(210, 80%, 60%)"
        />
        <ProgressBar
          label="Familiarity"
          value={relationship.familiarity}
          color="hsl(150, 60%, 50%)"
        />
      </div>

      <Separator className="bg-white/5" />

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatPill
          icon={MessageCircle}
          value={relationship.totalMessages.toLocaleString()}
          label="Messages"
          vibeColor={vibeColor}
        />
        <StatPill
          icon={Calendar}
          value={relationship.totalDays}
          label="Days"
          vibeColor={vibeColor}
        />
        <StatPill
          icon={Flame}
          value={relationship.currentStreak}
          label="Streak"
          vibeColor={vibeColor}
        />
        <StatPill
          icon={Heart}
          value={relationship.longestStreak}
          label="Best"
          vibeColor={vibeColor}
        />
      </div>

      {/* Recent changes */}
      {history.length > 0 && (
        <>
          <Separator className="bg-white/5" />
          <RecentChanges history={history} vibeColor={vibeColor} />
        </>
      )}
    </div>
  );
}
