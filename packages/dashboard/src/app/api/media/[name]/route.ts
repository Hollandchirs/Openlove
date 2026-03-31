import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

const REPO_ROOT = join(process.cwd(), "..", "..");
const CHARACTERS_DIR = join(REPO_ROOT, "characters");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface MediaFile {
  filename: string;
  type: "selfie" | "card" | "reference" | "other";
  url: string;
  size: number;
  modifiedAt: number;
}

function classifyFile(filename: string): MediaFile["type"] {
  const lower = filename.toLowerCase();
  if (lower.startsWith("reference")) return "reference";
  if (lower.startsWith("card")) return "card";
  if (lower.startsWith("selfie") || lower.includes("selfie")) return "selfie";
  return "other";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const slug = params.name;

  if (slug.includes("..") || slug.includes("/")) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, slug);
  if (!existsSync(charDir)) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const files: MediaFile[] = [];

  try {
    const entries = readdirSync(charDir);
    for (const entry of entries) {
      const ext = extname(entry).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      const fullPath = join(charDir, entry);
      const stat = statSync(fullPath);

      files.push({
        filename: entry,
        type: classifyFile(entry),
        url: `/api/media/${slug}/${encodeURIComponent(entry)}`,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to read character directory" },
      { status: 500 }
    );
  }

  // Sort newest first
  const sorted = [...files].sort((a, b) => b.modifiedAt - a.modifiedAt);

  return NextResponse.json({ files: sorted });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const slug = params.name;

  if (slug.includes("..") || slug.includes("/")) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, slug);
  if (!existsSync(charDir)) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "generate-selfie") {
    // Read FAL_KEY from .env
    const { readFile } = await import("node:fs/promises");
    const envPath = join(REPO_ROOT, ".env");
    let falKey = "";

    try {
      const envContent = await readFile(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("FAL_KEY=")) {
          falKey = trimmed.slice("FAL_KEY=".length).trim();
          break;
        }
      }
    } catch {
      return NextResponse.json(
        { error: "Could not read .env file" },
        { status: 500 }
      );
    }

    if (!falKey) {
      return NextResponse.json(
        { error: "FAL_KEY not configured. Add it to your .env file." },
        { status: 400 }
      );
    }

    // Find reference image for the character
    const exts = [".jpg", ".jpeg", ".png", ".webp"];
    let hasReference = false;
    for (const ext of exts) {
      if (existsSync(join(charDir, `reference${ext}`))) {
        hasReference = true;
        break;
      }
    }

    // Read character identity for prompt context
    let characterPrompt = "a beautiful person taking a selfie";
    const identityPath = join(charDir, "IDENTITY.md");
    if (existsSync(identityPath)) {
      const { readFileSync } = await import("fs");
      const content = readFileSync(identityPath, "utf-8");
      const appearanceMatch = content.match(
        /##\s+Appearance\s*\n([\s\S]*?)(?=^##\s|$)/m
      );
      if (appearanceMatch?.[1]) {
        characterPrompt = `A photorealistic selfie of: ${appearanceMatch[1].trim().slice(0, 500)}`;
      }
    }

    try {
      const response = await fetch("https://queue.fal.run/fal-ai/flux-realism", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: characterPrompt,
          image_size: "square_hd",
          num_images: 1,
          enable_safety_checker: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `fal.ai API error: ${response.status} ${errorText}` },
          { status: 502 }
        );
      }

      const result = await response.json();

      // fal.ai returns a request_id for queue-based requests
      return NextResponse.json({
        status: "queued",
        requestId: result.request_id,
        message: "Selfie generation queued. Check back shortly.",
        hasReference,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to call fal.ai: ${message}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
