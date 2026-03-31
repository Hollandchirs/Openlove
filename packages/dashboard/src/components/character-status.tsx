"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Clock, MessageCircle, Sparkles, Link2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStageDisplay } from "@/lib/stage-display";
import { ActivityStatusPanel } from "./activity-status";
import { useWakeStatus, type BridgePlatform } from "@/lib/use-wake-status";

interface CharacterStatusProps {
  slug: string;
  name: string;
  /** When true, the character is shown as "Online" regardless of wake status. */
  isChatActive?: boolean;
}

interface StatusData {
  relationshipStage: string | null;
  messageCount: number;
  closeness: number;
  trust: number;
  familiarity: number;
  lastInteraction: number;
  currentStreak: number;
  hasMemory: boolean;
  /** Live mood from the emotion engine (null if engine not loaded yet) */
  mood: string | null;
}

function formatLastActive(ts: number): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function HeartbeatScore({ closeness, trust, familiarity, hasMemory }: { closeness: number; trust: number; familiarity: number; hasMemory: boolean }) {
  // closeness/trust/familiarity are 0.0–1.0 floats; convert to 0–100 percentage
  const score = Math.round(((closeness + trust + familiarity) / 3) * 100);

  if (!hasMemory || (closeness === 0 && trust === 0 && familiarity === 0)) {
    return (
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-zinc-500" fill="none" />
        <div className="flex-1">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            No data yet — start a conversation!
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Heart
        className={cn(
          "h-4 w-4",
          score > 70 ? "text-rose-400" : score > 40 ? "text-pink-400" : "text-zinc-500"
        )}
        fill={score > 30 ? "currentColor" : "none"}
      />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">Heartbeat</span>
          <span className="text-xs font-medium text-[hsl(var(--foreground))]">{score}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-400 transition-all duration-500"
            style={{ width: `${Math.max(score, 2)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatRow({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/60" />
      <span className="flex-1 text-xs text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="text-xs font-medium text-[hsl(var(--foreground))]">{value}</span>
    </div>
  );
}

function getMoodFromStage(stage: string | null): string {
  switch (stage) {
    case "stranger": return "Curious";
    case "acquaintance": return "Warming up";
    case "friend": return "Comfortable";
    case "close_friend": return "Playful";
    case "intimate": return "Deeply connected";
    default: return "Neutral";
  }
}

/** Capitalize the first letter of a mood string for display (e.g. "feeling happy" -> "Feeling happy") */
function capitalizeMood(mood: string): string {
  if (!mood) return mood;
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

/** Fetch the live mood from the emotion engine and merge it into status state */
function fetchMood(
  slug: string,
  setStatus: (updater: (prev: StatusData | null) => StatusData | null) => void
): void {
  fetch(`/api/chat/${slug}/mood`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.mood) {
        setStatus((prev) => (prev ? { ...prev, mood: data.mood } : prev));
      }
    })
    .catch(() => {
      // Engine not loaded yet — mood stays null, fallback to stage-based mood
    });
}

/** Fetch relationship stats from the DB and merge into status state */
function fetchRelationshipStats(
  slug: string,
  setStatus: (updater: (prev: StatusData | null) => StatusData | null) => void
): void {
  fetch(`/api/character/${slug}/stats`)
    .then((r) => (r.ok ? r.json() : null))
    .then((stats) => {
      if (stats?.relationshipState) {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                closeness: stats.relationshipState.closeness ?? 0,
                trust: stats.relationshipState.trust ?? 0,
                familiarity: stats.relationshipState.familiarity ?? 0,
                lastInteraction: stats.relationshipState.lastInteraction ?? 0,
                currentStreak: stats.relationshipState.currentStreak ?? 0,
                relationshipStage: stats.relationshipState.stage ?? prev.relationshipStage,
                messageCount: stats.messageCount ?? prev.messageCount,
                hasMemory: true,
              }
            : prev
        );
      }
    })
    .catch(() => {
      // DB might not be available yet
    });
}

const ALL_PLATFORMS: { key: BridgePlatform; label: string; color: string; iconColor: string }[] = [
  { key: "whatsapp", label: "WhatsApp", color: "text-[#25D366]", iconColor: "#25D366" },
  { key: "discord", label: "Discord", color: "text-[#5865F2]", iconColor: "#5865F2" },
  { key: "telegram", label: "Telegram", color: "text-[#26A5E4]", iconColor: "#26A5E4" },
];

function BridgePlatformIcon({ platform }: { platform: BridgePlatform }) {
  switch (platform) {
    case "whatsapp":
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      );
    case "discord":
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      );
    case "telegram":
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
  }
}

function TwitterXIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface TwitterConfig {
  readonly configured: boolean;
  readonly autoPost: boolean;
  readonly username: string;
}

const EMPTY_TWITTER_CONFIG: TwitterConfig = {
  configured: false,
  autoPost: false,
  username: "",
};

/** Fetch Twitter config for the character from the settings API */
async function fetchTwitterConfig(slug: string): Promise<TwitterConfig> {
  try {
    const resp = await fetch(`/api/settings?character=${slug}`);
    if (!resp.ok) return EMPTY_TWITTER_CONFIG;

    const data = await resp.json();
    const charConfig = data.characterConfig;
    const globalKeys = data.keys ?? {};

    // Check if Twitter API credentials are configured
    const hasCredentials =
      Boolean(charConfig?.twitter?.clientId) ||
      Boolean(charConfig?.twitter?.apiKey);

    // Get the Twitter username from global env keys (TWITTER_USERNAME)
    const username = globalKeys.TWITTER_USERNAME ?? "";

    return {
      configured: hasCredentials,
      autoPost: Boolean(charConfig?.twitter?.autoPost),
      username,
    };
  } catch {
    return EMPTY_TWITTER_CONFIG;
  }
}

function TwitterConnectionRow({ slug }: { slug: string }) {
  const [twitterConfig, setTwitterConfig] = useState<TwitterConfig>(EMPTY_TWITTER_CONFIG);
  const [enabled, setEnabled] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchTwitterConfig(slug).then((config) => {
      setTwitterConfig(config);
      setEnabled(config.autoPost);
    });
  }, [slug]);

  const handleToggle = () => {
    if (!twitterConfig.configured) {
      // Navigate to settings to configure Twitter
      router.push(`/settings?character=${slug}&section=twitter`);
      return;
    }
    const newEnabled = !enabled;
    setEnabled(newEnabled);

    // Persist the autoPost toggle via settings API
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character: slug,
        characterConfig: { twitter: { autoPost: newEnabled } },
      }),
    }).catch(() => {
      // Revert on failure
      setEnabled(!newEnabled);
    });
  };

  // Derive the profile URL from the username
  const profileUrl =
    twitterConfig.username
      ? `https://x.com/${twitterConfig.username.replace(/^@/, "")}`
      : null;

  return (
    <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5">
      <button
        type="button"
        onClick={handleToggle}
        className="flex flex-1 items-center gap-2.5 transition-colors hover:bg-[hsl(var(--secondary))] rounded-lg -mx-2 -my-1.5 px-2 py-1.5"
      >
        <span className={enabled ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]/40"}>
          <TwitterXIcon />
        </span>
        <span className="flex-1 text-left text-xs text-[hsl(var(--foreground))]">Twitter / X</span>
        <div
          className={cn(
            "relative h-4 w-7 rounded-full transition-colors",
            enabled ? "bg-emerald-500" : "bg-zinc-600"
          )}
        >
          <div
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
              enabled ? "translate-x-3.5" : "translate-x-0.5"
            )}
          />
        </div>
      </button>
      {profileUrl && (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`@${twitterConfig.username.replace(/^@/, "")}`}
          className="flex items-center justify-center rounded-md p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function SocialMediaSection({ slug }: { slug: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ExternalLink className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/60" />
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Social Media</span>
      </div>
      <div className="space-y-1.5">
        <TwitterConnectionRow slug={slug} />
      </div>
    </div>
  );
}

function AppConnections({ slug }: { slug: string }) {
  const { wakeStatus } = useWakeStatus(slug);
  const connectedSet = new Set(wakeStatus.bridges);
  const [toggling, setToggling] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const router = useRouter();

  const toggleBridge = async (platform: BridgePlatform) => {
    if (toggling) return;
    setAlert(null);
    setToggling(platform);
    try {
      const connected = connectedSet.has(platform);
      const resp = await fetch(`/api/wake/${slug}/bridge/${platform}`, {
        method: connected ? "DELETE" : "POST",
      });
      const data = await resp.json();

      if (!resp.ok) {
        // If the API key is not configured, navigate to settings
        if (data.needsConfig) {
          const platformLabel =
            ALL_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;
          setAlert(`Configure ${platformLabel} API key in Settings`);
          // Navigate to settings after a brief delay so the user sees the alert
          setTimeout(() => {
            router.push("/settings");
          }, 1500);
          return;
        }
        // If the character is not awake, show a helpful message
        if (data.needsWake) {
          setAlert(`Wake ${slug} first before connecting bridges`);
          return;
        }
        setAlert(data.error ?? `Failed to toggle ${platform}`);
      }
      // On success the wake status poll will pick up the new bridges list
    } catch {
      setAlert("Network error — will retry on next poll");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/60" />
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Connections</span>
      </div>
      {alert && (
        <div className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-400">
          {alert}
        </div>
      )}
      <div className="space-y-1.5">
        {ALL_PLATFORMS.map((p) => {
          const connected = connectedSet.has(p.key);
          const isToggling = toggling === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => toggleBridge(p.key)}
              disabled={isToggling}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[hsl(var(--secondary))]"
            >
              <span className={connected ? p.color : "text-[hsl(var(--muted-foreground))]/40"}>
                <BridgePlatformIcon platform={p.key} />
              </span>
              <span className="flex-1 text-left text-xs text-[hsl(var(--foreground))]">{p.label}</span>
              {isToggling ? (
                <div className="h-4 w-7 flex items-center justify-center">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                </div>
              ) : (
                <div
                  className={cn(
                    "relative h-4 w-7 rounded-full transition-colors",
                    connected ? "bg-emerald-500" : "bg-zinc-600"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
                      connected ? "translate-x-3.5" : "translate-x-0.5"
                    )}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CharacterStatus({ slug, name, isChatActive = false }: CharacterStatusProps) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/character/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        // The API returns CharacterDetail directly
        setStatus({
          relationshipStage: data.relationshipStage ?? null,
          messageCount: data.messageCount ?? 0,
          closeness: 0,
          trust: 0,
          familiarity: 0,
          lastInteraction: 0,
          currentStreak: 0,
          hasMemory: data.hasMemory ?? false,
          mood: null,
        });

        // Try to fetch memory stats for richer data
        return fetch(`/api/character/${slug}/stats`);
      })
      .then((r) => {
        if (r && r.ok) return r.json();
        return null;
      })
      .then((stats) => {
        if (stats?.relationshipState) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  closeness: stats.relationshipState.closeness ?? 0,
                  trust: stats.relationshipState.trust ?? 0,
                  familiarity: stats.relationshipState.familiarity ?? 0,
                  lastInteraction: stats.relationshipState.lastInteraction ?? 0,
                  currentStreak: stats.relationshipState.currentStreak ?? 0,
                  messageCount: stats.messageCount ?? prev.messageCount,
                  hasMemory: true,
                }
              : prev
          );
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Fetch the live mood from the emotion engine (separate endpoint)
    fetchMood(slug, setStatus);
  }, [slug]);

  // Re-fetch mood and relationship stats periodically while the chat is active,
  // so the sidebar reflects emotional and relationship changes from ongoing conversation.
  useEffect(() => {
    if (!isChatActive) return;

    const interval = setInterval(() => {
      fetchMood(slug, setStatus);
      fetchRelationshipStats(slug, setStatus);
    }, 8_000); // every 8 seconds

    return () => clearInterval(interval);
  }, [slug, isChatActive]);

  const stageConfig = getStageDisplay(status?.relationshipStage ?? null);

  return (
    <div className="glass rounded-xl p-4">
      {/* Character avatar + name */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-sm font-bold text-white overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/character-image/${slug}`}
            alt={name}
            className="h-full w-full object-cover"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              if (target.parentElement) {
                target.parentElement.textContent = name.charAt(0).toUpperCase();
              }
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[hsl(var(--foreground))]">
            {name}
          </p>
          {!loading && (
            <p className={cn("text-xs font-medium", stageConfig.textColor)}>
              {stageConfig.label}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-[hsl(var(--secondary))]" />
          ))}
        </div>
      ) : status ? (
        <div className="space-y-3.5">
          {/* Live activity status */}
          <ActivityStatusPanel slug={slug} isChatActive={isChatActive} />

          <div className="h-px bg-[hsl(var(--border))]" />

          {/* Heartbeat score */}
          <HeartbeatScore
            closeness={status.closeness}
            trust={status.trust}
            familiarity={status.familiarity}
            hasMemory={status.hasMemory}
          />

          <div className="h-px bg-[hsl(var(--border))]" />

          {/* Stats */}
          <div className="space-y-2.5">
            <StatRow
              icon={MessageCircle}
              label="Messages"
              value={status.messageCount.toLocaleString()}
            />
            <StatRow
              icon={Clock}
              label="Last active"
              value={formatLastActive(status.lastInteraction)}
            />
            <StatRow
              icon={Sparkles}
              label="Mood"
              value={
                status.mood
                  ? capitalizeMood(status.mood)
                  : getMoodFromStage(status.relationshipStage)
              }
            />
            {status.currentStreak > 0 && (
              <StatRow
                icon={Heart}
                label="Streak"
                value={`${status.currentStreak} days`}
              />
            )}
          </div>

          <div className="h-px bg-[hsl(var(--border))]" />

          {/* App connections */}
          <AppConnections slug={slug} />

          <div className="h-px bg-[hsl(var(--border))]" />

          {/* Social media */}
          <SocialMediaSection slug={slug} />
        </div>
      ) : (
        <p className="text-xs text-[hsl(var(--muted-foreground))]/50">
          No data yet. Start chatting!
        </p>
      )}
    </div>
  );
}
