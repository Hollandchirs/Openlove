import { NextRequest, NextResponse } from "next/server";
import { getCharacterDetail } from "@/lib/data";
import { validateCharacterName } from "@/lib/validate-name";

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!validateCharacterName(params.name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const character = getCharacterDetail(params.name);

  if (!character) {
    return NextResponse.json(
      { error: "Character not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(character);
}
