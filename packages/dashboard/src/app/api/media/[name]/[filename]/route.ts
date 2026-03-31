import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string; filename: string } }
) {
  const { name, filename } = params;

  // Prevent directory traversal
  if (
    name.includes("..") ||
    name.includes("/") ||
    filename.includes("..") ||
    filename.includes("/")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Only allow known media files
  const ext = extname(filename).toLowerCase();
  if (!MIME_TYPES[ext]) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 }
    );
  }

  // Check both character root and media/ subdirectory
  let filePath = join(CHARACTERS_DIR, name, filename);
  if (!existsSync(filePath)) {
    filePath = join(CHARACTERS_DIR, name, "media", filename);
  }
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": MIME_TYPES[ext] ?? "image/jpeg",
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
