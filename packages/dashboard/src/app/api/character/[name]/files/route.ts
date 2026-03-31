import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

const ALLOWED_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md"] as const;
type AllowedFile = (typeof ALLOWED_FILES)[number];

function isAllowedFile(filename: string): filename is AllowedFile {
  return ALLOWED_FILES.includes(filename as AllowedFile);
}

function isValidCharacterName(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name) && !name.includes("..");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  if (!isValidCharacterName(name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir)) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const files: Record<string, string> = {};

  for (const filename of ALLOWED_FILES) {
    const filePath = join(charDir, filename);
    if (existsSync(filePath)) {
      files[filename] = readFileSync(filePath, "utf-8");
    } else {
      files[filename] = "";
    }
  }

  return NextResponse.json({ files });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  if (!isValidCharacterName(name)) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir)) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  let body: { filename: string; content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { filename, content } = body;

  if (!filename || typeof content !== "string") {
    return NextResponse.json(
      { error: "Missing filename or content" },
      { status: 400 }
    );
  }

  if (content.length > 50000) {
    return NextResponse.json(
      { error: "Content too long (max 50000 chars)" },
      { status: 400 }
    );
  }

  if (!isAllowedFile(filename)) {
    return NextResponse.json(
      { error: `File not allowed. Must be one of: ${ALLOWED_FILES.join(", ")}` },
      { status: 403 }
    );
  }

  const filePath = join(charDir, filename);
  writeFileSync(filePath, content, "utf-8");

  return NextResponse.json({ ok: true, filename });
}
