import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { validateCharacterName } from "@/lib/validate-name";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

/** 30 minutes in milliseconds — activity older than this means offline */
const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000;

interface ActivityEpisode {
  id: number;
  type: string;
  title: string;
  description: string;
  metadata: string | null;
  timestamp: number;
}

/** Returns true if the episode is an internal proactive-message event that should be hidden from users. */
function isProactiveMessageEpisode(episode: ActivityEpisode): boolean {
  const lower = episode.title.toLowerCase();
  return lower.includes("proactive message") || lower.includes("proactive_message");
}

interface ActivityResponse {
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

function getActivityIcon(type: string, title: string): string {
  const lower = title.toLowerCase();

  if (type === "music" || lower.includes("listened to") || lower.includes("listening")) {
    return "music";
  }
  if (type === "drama" || lower.includes("watched") || lower.includes("watching")) {
    if (lower.includes("youtube")) return "youtube";
    return "tv";
  }
  if (lower.includes("brows") || lower.includes("scrolling") || lower.includes("twitter") || lower.includes("pinterest")) {
    return "globe";
  }
  if (lower.includes("posted") || lower.includes("tweet") || lower.includes("social")) {
    return "share";
  }
  if (type === "mood") {
    return "sparkles";
  }
  return "activity";
}

function formatActivityTitle(type: string, title: string, metadata: Record<string, unknown> | null): string {
  if (type === "music" && metadata) {
    const track = metadata.track as string | undefined;
    const artist = metadata.artist as string | undefined;
    if (track && artist) return `${track} - ${artist}`;
  }

  if (type === "drama" && metadata) {
    const show = metadata.show as string | undefined;
    const episode = metadata.episode as string | undefined;
    const season = metadata.season as string | undefined;
    if (show) {
      const ep = episode ? ` S${season ?? "1"}E${episode}` : "";
      return `${show}${ep}`;
    }
  }

  // Clean up episode-style titles
  return title
    .replace(/^Listened to\s+/i, "")
    .replace(/^Watched\s+/i, "")
    .replace(/^Browsing\s+/i, "")
    .replace(/^Posted on\s+/i, "Posted: ");
}

function findCharacterDbPath(name: string): string | null {
  const charDir = join(CHARACTERS_DIR, name);
  const dbPath = join(charDir, "memory.db");
  if (existsSync(dbPath)) return dbPath;

  // Try case-insensitive search
  if (!existsSync(CHARACTERS_DIR)) return null;
  try {
    const entries = readdirSync(CHARACTERS_DIR);
    for (const entry of entries) {
      if (entry.toLowerCase() === name.toLowerCase()) {
        const candidateDb = join(CHARACTERS_DIR, entry, "memory.db");
        if (existsSync(candidateDb)) return candidateDb;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!validateCharacterName(params.name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const dbPath = findCharacterDbPath(params.name);

  if (!dbPath) {
    const response: ActivityResponse = {
      status: "offline",
      activity: null,
      lastSeen: null,
    };
    return NextResponse.json(response);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    // Get the most recent activity-related episodes
    const activityTypes = ["music", "drama", "event"];
    const placeholders = activityTypes.map(() => "?").join(",");

    const rawEpisodes = db
      .prepare(
        `SELECT id, type, title, description, metadata, timestamp
         FROM episodes
         WHERE type IN (${placeholders})
         ORDER BY timestamp DESC
         LIMIT 20`
      )
      .all(...activityTypes) as ActivityEpisode[];

    // Filter out internal proactive-message episodes — these are server-side
    // bookkeeping and should never be shown to users.
    const recentEpisodes = rawEpisodes
      .filter((ep) => !isProactiveMessageEpisode(ep))
      .slice(0, 5);

    // Also check recent messages as a fallback for "chatting" status
    let lastMessageTs: number | null = null;
    try {
      const hasMessages = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();
      if (hasMessages) {
        const msg = db.prepare("SELECT timestamp FROM messages ORDER BY timestamp DESC LIMIT 1").get() as { timestamp: number } | undefined;
        if (msg) lastMessageTs = msg.timestamp;
      }
    } catch { /* ignore */ }

    db.close();

    const now = Date.now();

    // If no episodes but recent messages, show "chatting" status
    if (recentEpisodes.length === 0) {
      if (lastMessageTs && (now - lastMessageTs) < ACTIVE_THRESHOLD_MS) {
        const response: ActivityResponse = {
          status: "active",
          activity: {
            type: "chat",
            title: "Chatting with you",
            description: "",
            icon: "message",
            metadata: null,
          },
          lastSeen: lastMessageTs,
        };
        return NextResponse.json(response);
      }
      const response: ActivityResponse = {
        status: "offline",
        activity: null,
        lastSeen: lastMessageTs,
      };
      return NextResponse.json(response);
    }

    const latest = recentEpisodes[0];
    const timeSince = now - latest.timestamp;
    const parsedMetadata = latest.metadata ? JSON.parse(latest.metadata) : null;

    // If episodes are stale but messages are fresh, show chatting
    if (timeSince >= ACTIVE_THRESHOLD_MS && lastMessageTs && (now - lastMessageTs) < ACTIVE_THRESHOLD_MS) {
      const response: ActivityResponse = {
        status: "active",
        activity: {
          type: "chat",
          title: "Chatting with you",
          description: "",
          icon: "message",
          metadata: null,
        },
        lastSeen: lastMessageTs,
      };
      return NextResponse.json(response);
    }

    const isActive = timeSince < ACTIVE_THRESHOLD_MS;

    const response: ActivityResponse = {
      status: isActive ? "active" : "offline",
      activity: {
        type: latest.type,
        title: formatActivityTitle(latest.type, latest.title, parsedMetadata),
        description: latest.description,
        icon: getActivityIcon(latest.type, latest.title),
        metadata: parsedMetadata,
      },
      lastSeen: latest.timestamp,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[Activity API] Error:", err);
    const response: ActivityResponse = {
      status: "offline",
      activity: null,
      lastSeen: null,
    };
    return NextResponse.json(response);
  }
}
