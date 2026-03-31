import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import matter from "gray-matter";

// Characters live at the repo root, two levels above packages/dashboard
const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

export interface CharacterSummary {
  /** Directory name (slug) used for routing */
  slug: string;
  /** Display name from IDENTITY.md H1 */
  name: string;
  age: string;
  location: string;
  job: string;
  hobbies: string[];
  /** Absolute path to reference image, or null */
  referenceImage: string | null;
  /** Relative path for Next.js image serving */
  referenceImageRelative: string | null;
  /** Whether a memory.db exists (character has been chatted with) */
  hasMemory: boolean;
  /** Whether a card.png exists */
  hasCard: boolean;
  /** Relationship stage from memory.db, if available */
  relationshipStage: string | null;
  /** Total message count from memory.db, if available */
  messageCount: number;
  /** Gender from frontmatter */
  gender: string;
  /** Language from frontmatter */
  language: string;
}

function parseIdentityMd(identityPath: string): {
  name: string;
  age: string;
  location: string;
  job: string;
  hobbies: string[];
  gender: string;
  language: string;
} {
  const raw = readFileSync(identityPath, "utf-8");
  const { content, data: frontmatter } = matter(raw);

  const nameMatch = content.match(/^#\s+(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? "Unknown";

  const ageMatch = content.match(/\*\*Age:\*\*\s*(\d+)/i);
  const age = ageMatch?.[1] ?? "";

  const fromMatch = content.match(/\*\*From:\*\*\s*(.+)/i);
  const locationRaw = fromMatch?.[1]?.trim() ?? "";
  const location = locationRaw
    .replace(/\s*\(.*\)/, "")
    .split(" — ")[0]
    .split(" - ")[0]
    .trim();

  const jobMatch = content.match(/\*\*Job:\*\*\s*(.+)/i);
  const jobRaw = jobMatch?.[1]?.trim() ?? "";
  const job =
    jobRaw
      .split(/[—–.+]/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? "";

  const hobbiesMatch = content.match(/\*\*Hobbies:\*\*\s*(.+)/i);
  const hobbiesRaw = hobbiesMatch?.[1] ?? "";
  const hobbies = hobbiesRaw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    name,
    age,
    location: location.length > 40 ? "" : location,
    job,
    hobbies,
    gender: (frontmatter.gender as string) ?? "female",
    language: (frontmatter.language as string) ?? "en",
  };
}

function findReferenceImage(
  charDir: string,
  name: string
): { absolute: string; relative: string } | null {
  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  for (const ext of exts) {
    const imgPath = join(charDir, `reference${ext}`);
    if (existsSync(imgPath)) {
      return {
        absolute: imgPath,
        relative: `/api/character-image/${name}`,
      };
    }
  }
  return null;
}

function getRelationshipData(
  charDir: string
): { stage: string; messageCount: number; full: RelationshipData | null } | null {
  const dbPath = join(charDir, "memory.db");
  if (!existsSync(dbPath)) return null;

  try {
    // We read the SQLite file via better-sqlite3 at build time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    let stage: string | null = null;
    let messageCount = 0;
    let full: RelationshipData | null = null;

    try {
      const row = db
        .prepare("SELECT value FROM relationship WHERE key = 'state'")
        .get() as { value: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.value);
        stage = parsed.stage ?? null;
        messageCount = parsed.totalMessages ?? 0;
        full = {
          closeness: parsed.closeness ?? 0,
          trust: parsed.trust ?? 0,
          familiarity: parsed.familiarity ?? 0,
          totalMessages: parsed.totalMessages ?? 0,
          totalDays: parsed.totalDays ?? 0,
          currentStreak: parsed.currentStreak ?? 0,
          longestStreak: parsed.longestStreak ?? 0,
          lastInteraction: parsed.lastInteraction ?? 0,
          stage: parsed.stage ?? "stranger",
        };
      }
    } catch {
      // Table might not exist yet
    }

    if (messageCount === 0) {
      try {
        const countRow = db
          .prepare("SELECT COUNT(*) as cnt FROM messages")
          .get() as { cnt: number } | undefined;
        messageCount = countRow?.cnt ?? 0;
      } catch {
        // messages table might not exist
      }
    }

    db.close();
    return { stage: stage ?? "stranger", messageCount, full };
  } catch {
    return null;
  }
}

export function getCharacters(): CharacterSummary[] {
  if (!existsSync(CHARACTERS_DIR)) return [];

  const entries = readdirSync(CHARACTERS_DIR, { withFileTypes: true });

  const characters: CharacterSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "example") continue;

    const charDir = join(CHARACTERS_DIR, entry.name);
    const identityPath = join(charDir, "IDENTITY.md");

    if (!existsSync(identityPath)) continue;

    const identity = parseIdentityMd(identityPath);
    const refImage = findReferenceImage(charDir, entry.name);
    const relationship = getRelationshipData(charDir);

    characters.push({
      slug: entry.name,
      name: identity.name,
      age: identity.age,
      location: identity.location,
      job: identity.job,
      hobbies: identity.hobbies,
      referenceImage: refImage?.absolute ?? null,
      referenceImageRelative: refImage?.relative ?? null,
      hasMemory: existsSync(join(charDir, "memory.db")),
      hasCard: existsSync(join(charDir, "card.png")),
      relationshipStage: relationship?.stage ?? null,
      messageCount: relationship?.messageCount ?? 0,
      gender: identity.gender,
      language: identity.language,
    });
  }

  // Sort: characters with memories first, then alphabetical
  return characters.sort((a, b) => {
    if (a.hasMemory !== b.hasMemory) return a.hasMemory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function getCharacter(name: string): CharacterSummary | null {
  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir)) return null;

  const identityPath = join(charDir, "IDENTITY.md");
  if (!existsSync(identityPath)) return null;

  const identity = parseIdentityMd(identityPath);
  const refImage = findReferenceImage(charDir, name);
  const relationship = getRelationshipData(charDir);

  return {
    slug: name,
    name: identity.name,
    age: identity.age,
    location: identity.location,
    job: identity.job,
    hobbies: identity.hobbies,
    referenceImage: refImage?.absolute ?? null,
    referenceImageRelative: refImage?.relative ?? null,
    hasMemory: existsSync(join(charDir, "memory.db")),
    hasCard: existsSync(join(charDir, "card.png")),
    relationshipStage: relationship?.stage ?? null,
    messageCount: relationship?.messageCount ?? 0,
    gender: identity.gender,
    language: identity.language,
  };
}

// ── Full Character Detail (for profile page) ──────────────────────────

export interface RelationshipData {
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

export interface CharacterDetail extends CharacterSummary {
  /** Full IDENTITY.md sections */
  identity: {
    appearance: string;
    background: string;
    languages: string;
    fullJob: string;
    timezone: string;
  };
  /** Parsed SOUL.md */
  soul: {
    voiceAndVibe: string;
    loves: string[];
    dislikes: string[];
    emotionalPatterns: string[];
    thingsSheDoes: string[];
    speechPatterns: string[];
  };
  /** Parsed USER.md */
  user: {
    howWeMet: string;
    whatSheCalls: string;
    dynamic: string;
    thingsKnown: string[];
    sharedHistory: string[];
    feelings: string;
  };
  /** Vibe color extracted from character theme */
  vibeColor: string;
  /** Full relationship state from memory.db */
  relationship: RelationshipData | null;
}

function extractSection(content: string, heading: string): string {
  const regex = new RegExp(
    `^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?!\\n))`,
    "mi"
  );
  const match = content.match(regex);
  return match?.[1]?.trim() ?? "";
}

function extractBulletList(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.match(/^[-*]\s+/))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function extractNamedItems(section: string): string[] {
  const lines = section.split("\n").filter((l) => l.trim());
  const items: string[] = [];
  let current = "";

  for (const line of lines) {
    if (line.match(/^[-*]\s+/) || line.match(/^[A-Z]/)) {
      if (current) items.push(current.trim());
      current = line.replace(/^[-*]\s+/, "");
    } else {
      current += " " + line.trim();
    }
  }
  if (current) items.push(current.trim());
  return items;
}

function parseSoulMd(soulPath: string): CharacterDetail["soul"] {
  if (!existsSync(soulPath)) {
    return {
      voiceAndVibe: "",
      loves: [],
      dislikes: [],
      emotionalPatterns: [],
      thingsSheDoes: [],
      speechPatterns: [],
    };
  }
  const content = readFileSync(soulPath, "utf-8");

  const voiceAndVibe = extractSection(content, "Voice & Vibe");
  const lovesSection = extractSection(content, "Loves");
  const dislikesSection = extractSection(content, "Dislikes");
  const emotionalSection = extractSection(content, "Emotional Patterns");
  const thingsSection = extractSection(content, "Things She Does");
  const speechSection = extractSection(content, "Speech Patterns");

  return {
    voiceAndVibe,
    loves: extractBulletList(lovesSection).length > 0
      ? extractBulletList(lovesSection)
      : extractNamedItems(lovesSection),
    dislikes: extractBulletList(dislikesSection).length > 0
      ? extractBulletList(dislikesSection)
      : extractNamedItems(dislikesSection),
    emotionalPatterns: extractNamedItems(emotionalSection),
    thingsSheDoes: extractBulletList(thingsSection),
    speechPatterns: extractBulletList(speechSection),
  };
}

function parseUserMd(userPath: string): CharacterDetail["user"] {
  if (!existsSync(userPath)) {
    return {
      howWeMet: "",
      whatSheCalls: "",
      dynamic: "",
      thingsKnown: [],
      sharedHistory: [],
      feelings: "",
    };
  }
  const content = readFileSync(userPath, "utf-8");

  return {
    howWeMet:
      extractSection(content, "How We Met") ||
      extractSection(content, "About the User"),
    whatSheCalls: extractSection(content, "What She Calls You"),
    dynamic:
      extractSection(content, "Our Dynamic") ||
      extractSection(content, "How You Talk to Them"),
    thingsKnown: extractBulletList(
      extractSection(content, "Things She Knows About You")
    ),
    sharedHistory: extractBulletList(
      extractSection(content, "Our Shared History")
    ),
    feelings: extractSection(content, "Her Feelings Toward You"),
  };
}

const CHARACTER_VIBE_COLORS: Record<string, string> = {
  luna: "#9b7dbd",     // lavender purple
  yuna: "#ff4d9b",     // neon pink
  helora: "#d4a574",   // warm gold
  sable: "#c49b6a",    // rich amber
  noa: "#e84393",      // cherry pink
  lunna: "#f5a0c0",    // rose pink
};

export function getCharacterDetail(name: string): CharacterDetail | null {
  const summary = getCharacter(name);
  if (!summary) return null;

  const charDir = join(CHARACTERS_DIR, name);
  const identityPath = join(charDir, "IDENTITY.md");
  const soulPath = join(charDir, "SOUL.md");
  const userPath = join(charDir, "USER.md");

  const identityContent = readFileSync(identityPath, "utf-8");
  const { content: identityBody, data: frontmatter } = matter(identityContent);

  const jobMatch = identityBody.match(/\*\*Job:\*\*\s*(.+)/i);
  const langMatch = identityBody.match(/\*\*Languages:\*\*\s*(.+)/i);

  const relationship = getRelationshipData(charDir);

  return {
    ...summary,
    identity: {
      appearance: extractSection(identityBody, "Appearance"),
      background: extractSection(identityBody, "Background"),
      languages: langMatch?.[1]?.trim() ?? "",
      fullJob: jobMatch?.[1]?.trim() ?? summary.job,
      timezone: (frontmatter.timezone as string) ?? "",
    },
    soul: parseSoulMd(soulPath),
    user: parseUserMd(userPath),
    vibeColor: CHARACTER_VIBE_COLORS[name] ?? "#a78bfa",
    relationship: relationship?.full ?? null,
  };
}

export function getAllCharacterNames(): string[] {
  if (!existsSync(CHARACTERS_DIR)) return [];
  return readdirSync(CHARACTERS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "example")
    .filter((e) => existsSync(join(CHARACTERS_DIR, e.name, "IDENTITY.md")))
    .map((e) => e.name);
}

// ── Memory Stats ─────────────────────────────────────────────────────

export interface MemoryStats {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  episodeCount: number;
  episodesByType: Record<string, number>;
  relationshipState: {
    closeness: number;
    trust: number;
    familiarity: number;
    stage: string;
    totalDays: number;
    currentStreak: number;
    longestStreak: number;
    lastInteraction: number;
  } | null;
  relationshipHistory: Array<{
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
  }>;
  recentMessages: Array<{
    id: number;
    role: string;
    content: string;
    timestamp: number;
    platform: string | null;
  }>;
  recentEpisodes: Array<{
    id: number;
    type: string;
    title: string;
    description: string;
    timestamp: number;
  }>;
}

export function getMemoryStats(name: string): MemoryStats | null {
  const charDir = join(CHARACTERS_DIR, name);
  const dbPath = join(charDir, "memory.db");
  if (!existsSync(dbPath)) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    const stats: MemoryStats = {
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      episodeCount: 0,
      episodesByType: {},
      relationshipState: null,
      relationshipHistory: [],
      recentMessages: [],
      recentEpisodes: [],
    };

    // Message counts
    try {
      const total = db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number };
      stats.messageCount = total.cnt;

      const userCount = db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE role = 'user'").get() as { cnt: number };
      stats.userMessageCount = userCount.cnt;

      const assistantCount = db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE role = 'assistant'").get() as { cnt: number };
      stats.assistantMessageCount = assistantCount.cnt;
    } catch {
      // messages table may not exist
    }

    // Episodes
    try {
      const epTotal = db.prepare("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number };
      stats.episodeCount = epTotal.cnt;

      const epTypes = db.prepare("SELECT type, COUNT(*) as cnt FROM episodes GROUP BY type").all() as Array<{ type: string; cnt: number }>;
      for (const row of epTypes) {
        stats.episodesByType[row.type] = row.cnt;
      }

      stats.recentEpisodes = (db.prepare("SELECT id, type, title, description, timestamp FROM episodes ORDER BY timestamp DESC LIMIT 20").all() as Array<{
        id: number; type: string; title: string; description: string; timestamp: number;
      }>);
    } catch {
      // episodes table may not exist
    }

    // Relationship state
    try {
      const row = db.prepare("SELECT value FROM relationship WHERE key = 'state'").get() as { value: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.value);
        stats.relationshipState = {
          closeness: parsed.closeness ?? 0,
          trust: parsed.trust ?? 0,
          familiarity: parsed.familiarity ?? 0,
          stage: parsed.stage ?? "stranger",
          totalDays: parsed.totalDays ?? 0,
          currentStreak: parsed.currentStreak ?? 0,
          longestStreak: parsed.longestStreak ?? 0,
          lastInteraction: parsed.lastInteraction ?? 0,
        };
      }
    } catch {
      // relationship table may not exist
    }

    // Relationship history
    try {
      stats.relationshipHistory = (db.prepare(
        "SELECT id, timestamp, closeness, trust, familiarity, closeness_delta, trust_delta, familiarity_delta, trigger_text, stage FROM relationship_history ORDER BY timestamp DESC LIMIT 50"
      ).all() as Array<{
        id: number; timestamp: number; closeness: number; trust: number; familiarity: number;
        closeness_delta: number; trust_delta: number; familiarity_delta: number;
        trigger_text: string | null; stage: string;
      }>).map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        closeness: row.closeness,
        trust: row.trust,
        familiarity: row.familiarity,
        closenessDelta: row.closeness_delta,
        trustDelta: row.trust_delta,
        familiarityDelta: row.familiarity_delta,
        triggerText: row.trigger_text,
        stage: row.stage,
      }));
    } catch {
      // relationship_history table may not exist
    }

    // Recent messages
    try {
      stats.recentMessages = (db.prepare(
        "SELECT id, role, content, timestamp, platform FROM messages ORDER BY timestamp DESC LIMIT 30"
      ).all() as Array<{
        id: number; role: string; content: string; timestamp: number; platform: string | null;
      }>);
    } catch {
      // messages table may not exist
    }

    db.close();
    return stats;
  } catch {
    return null;
  }
}
