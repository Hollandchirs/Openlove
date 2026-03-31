import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { validateCharacterName } from "@/lib/validate-name";
import { CHARACTERS_DIR } from "@/lib/repo-root";

interface MessageRow {
  id: number;
  role: string;
  content: string;
  timestamp: number;
  platform: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  if (!validateCharacterName(name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const { searchParams } = request.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const search = searchParams.get("search")?.trim() ?? "";
  // Optional explicit offset — overrides page-based calculation when provided.
  // This allows the client to request e.g. the last 50 messages regardless of
  // whether the total is a clean multiple of the page size.
  const rawOffset = searchParams.get("offset");
  const explicitOffset = rawOffset !== null ? Math.max(0, parseInt(rawOffset, 10)) : null;

  const charDir = join(CHARACTERS_DIR, name);
  const dbPath = join(charDir, "memory.db");

  if (!existsSync(dbPath)) {
    return NextResponse.json(
      { messages: [], total: 0, page },
      { status: 200 }
    );
  }

  // Filter out internal system/trigger messages from the AutonomousScheduler.
  // These are user-role messages like "[random_thought trigger]", "[drama trigger]", etc.
  const SYSTEM_FILTER = `
    AND NOT (role = 'user' AND content LIKE '[%trigger]')
    AND NOT (role = 'user' AND content LIKE '[%update]')
    AND NOT (role = 'user' AND content LIKE '[proactive_%')`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    let total = 0;
    let messages: MessageRow[] = [];

    try {
      // Use explicit offset when provided, otherwise fall back to page-based
      const offset = explicitOffset !== null ? explicitOffset : (page - 1) * limit;

      if (search.length > 0) {
        const countRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM messages
             WHERE content LIKE ? ${SYSTEM_FILTER}`
          )
          .get(`%${search}%`) as { cnt: number };
        total = countRow.cnt;

        messages = db
          .prepare(
            `SELECT id, role, content, timestamp, platform
             FROM messages
             WHERE content LIKE ? ${SYSTEM_FILTER}
             ORDER BY timestamp ASC
             LIMIT ? OFFSET ?`
          )
          .all(`%${search}%`, limit, offset) as MessageRow[];
      } else {
        const countRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM messages
             WHERE 1=1 ${SYSTEM_FILTER}`
          )
          .get() as { cnt: number };
        total = countRow.cnt;

        messages = db
          .prepare(
            `SELECT id, role, content, timestamp, platform
             FROM messages
             WHERE 1=1 ${SYSTEM_FILTER}
             ORDER BY timestamp ASC
             LIMIT ? OFFSET ?`
          )
          .all(limit, offset) as MessageRow[];
      }
    } catch (innerErr) {
      console.error(`[messages API] Query error for ${name}:`, innerErr);
    }

    db.close();

    return NextResponse.json({ messages, total, page });
  } catch (err) {
    console.error(`[messages API] DB error for ${name}:`, err);
    return NextResponse.json(
      { messages: [], total: 0, page },
      { status: 200 }
    );
  }
}
