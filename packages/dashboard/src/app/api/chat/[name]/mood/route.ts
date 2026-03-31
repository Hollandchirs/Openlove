import { NextRequest, NextResponse } from "next/server";
import { engineCache } from "@/lib/engine-cache";
import { validateCharacterName } from "@/lib/validate-name";

// Force this route to be fully dynamic
export const dynamic = "force-dynamic";

/**
 * Returns the current mood from the in-memory ConversationEngine cache.
 * The engine is created by the chat route on first message — if no engine
 * exists yet (no conversation started this session), returns null.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!validateCharacterName(params.name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  try {
    const engine = engineCache.get(params.name);
    if (!engine || typeof engine.getMood !== "function") {
      return NextResponse.json({ mood: null });
    }

    return NextResponse.json({ mood: engine.getMood() });
  } catch {
    return NextResponse.json({ mood: null });
  }
}
