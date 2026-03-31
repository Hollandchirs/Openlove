import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { CHARACTERS_DIR } from "@/lib/repo-root";

// ── Allowed MIME types ──────────────────────────────────────────────────

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ── Route handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  // Prevent directory traversal
  if (name.includes("..") || name.includes("/")) {
    return NextResponse.json({ error: "Invalid character name" }, { status: 400 });
  }

  const charDir = join(CHARACTERS_DIR, name);
  if (!existsSync(charDir)) {
    return NextResponse.json(
      { error: `Character "${name}" not found` },
      { status: 404 }
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data. Send multipart/form-data with a 'file' field." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "No file provided. Include a 'file' field." },
      { status: 400 }
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  // Validate MIME type
  const mimeType = file.type;
  const allowedExt = ALLOWED_TYPES[mimeType];
  if (!allowedExt) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}` },
      { status: 400 }
    );
  }

  // Determine media type category
  let mediaType: "image" | "video" | "audio";
  if (mimeType.startsWith("image/")) {
    mediaType = "image";
  } else if (mimeType.startsWith("video/")) {
    mediaType = "video";
  } else {
    mediaType = "audio";
  }

  // Create media directory if it doesn't exist
  const mediaDir = join(charDir, "media");
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }

  // Generate filename: timestamp-originalname or timestamp.ext
  const originalName = file instanceof File ? file.name : "";
  const sanitizedName = originalName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 100);

  const timestamp = Date.now();
  const ext = extname(sanitizedName) && ALLOWED_TYPES[mimeType]
    ? extname(sanitizedName).toLowerCase()
    : allowedExt;

  const filename = sanitizedName
    ? `${timestamp}-${sanitizedName.replace(/\.[^.]+$/, "")}${ext}`
    : `${timestamp}${ext}`;

  const filePath = join(mediaDir, filename);

  // Write file to disk
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filePath, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json(
      { error: `Failed to save file: ${message}` },
      { status: 500 }
    );
  }

  const url = `/api/media/${name}/${encodeURIComponent(filename)}`;

  return NextResponse.json({ url, type: mediaType, filename });
}
