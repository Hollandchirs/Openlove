import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const slug = params.name;

  // Prevent directory traversal
  if (slug.includes("..") || slug.includes("/")) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, slug);
  if (!existsSync(charDir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Find reference image
  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  for (const ext of exts) {
    const imgPath = join(charDir, `reference${ext}`);
    if (existsSync(imgPath)) {
      const buffer = readFileSync(imgPath);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": MIME_TYPES[ext] ?? "image/jpeg",
          "Cache-Control": "public, max-age=3600, immutable",
        },
      });
    }
  }

  // Try card.png as fallback
  const cardPath = join(charDir, "card.png");
  if (existsSync(cardPath)) {
    const buffer = readFileSync(cardPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  }

  return NextResponse.json({ error: "No image found" }, { status: 404 });
}
