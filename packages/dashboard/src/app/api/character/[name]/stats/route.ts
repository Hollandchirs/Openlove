import { NextRequest, NextResponse } from "next/server";
import { getMemoryStats } from "@/lib/data";
import { validateCharacterName } from "@/lib/validate-name";

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!validateCharacterName(params.name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const stats = getMemoryStats(params.name);

  if (!stats) {
    return NextResponse.json(
      { messageCount: 0, relationshipState: null },
      { status: 200 }
    );
  }

  return NextResponse.json(stats);
}
