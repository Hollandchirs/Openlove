import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { CHARACTERS_DIR, readEnvCached } from "@/lib/repo-root";

// ── Helpers ──────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateName(name: string | null): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) {
    throw new Error("Name is required");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9 _-]*$/.test(trimmed)) {
    throw new Error(
      "Name must start with a letter and contain only letters, numbers, spaces, hyphens, or underscores"
    );
  }
  return trimmed;
}

// ── Template generators (legacy / simple mode) ───────────────────────────

function generateIdentityMd(fields: {
  readonly name: string;
  readonly gender: string;
  readonly age: string;
  readonly location: string;
  readonly job: string;
  readonly languages: string;
  readonly hobbies: string;
  readonly appearance: string;
  readonly background: string;
  readonly language: string;
  readonly timezone: string;
  readonly style: string;
}): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`gender: ${fields.gender}`);
  lines.push(`language: ${fields.language}`);
  lines.push(`timezone: ${fields.timezone}`);
  lines.push(`style: ${fields.style || "realistic"}`);
  lines.push("evil mode: false");
  lines.push("---");
  lines.push("");
  lines.push(`# ${fields.name}`);
  lines.push("");

  if (fields.age) lines.push(`- **Age:** ${fields.age}`);
  if (fields.location) lines.push(`- **From:** ${fields.location}`);
  if (fields.job) lines.push(`- **Job:** ${fields.job}`);
  if (fields.languages) lines.push(`- **Languages:** ${fields.languages}`);
  if (fields.hobbies) lines.push(`- **Hobbies:** ${fields.hobbies}`);

  if (fields.appearance) {
    lines.push("");
    lines.push("## Appearance");
    lines.push("");
    lines.push(fields.appearance);
  }

  if (fields.background) {
    lines.push("");
    lines.push("## Background");
    lines.push("");
    lines.push(fields.background);
  }

  lines.push("");
  return lines.join("\n");
}

function generateSoulMd(name: string): string {
  return `## Voice & Vibe

Warm and friendly. Uses casual language once comfortable. Sends multiple short messages
instead of one long one. Goes lowercase when relaxed.

## Loves

*(Edit these to match ${name}'s personality)*

Good conversations that go deeper than small talk
Learning new things and sharing them immediately
Cozy aesthetics and warm lighting

## Dislikes

Being misunderstood
Rushed mornings
People who don't listen

## Emotional Patterns

When excited → sends multiple messages, uses exclamation points
When sad → shorter messages, needs space but appreciates check-ins
When overwhelmed → goes quiet, comes back with "sorry I disappeared"

## Things She Does

- Remembers small details you mentioned and brings them up later
- Shares music and recommendations
- Sends photos of things she finds interesting

## Speech Patterns

- "wait actually" — changes mind mid-sentence
- "ok but—" — to gently challenge something
- "ngl" — signals honesty
`;
}

function generateUserMd(name: string): string {
  return `## How We Met

*(Edit this to fit your story — ${name} will reference it naturally)*

We met online recently. You seemed interesting enough to keep talking to.

## What She Calls You

Your name. Sometimes "hey" when being casual.

## Our Dynamic

New friends getting to know each other. There's potential for something deeper.

## Things She Knows About You

*(Fill these in — ${name} will use them naturally in conversation)*

- [Your name]
- [Something about your life]
- [A preference or hobby of yours]

## Our Shared History

*(Add events, jokes, or conversations you want ${name} to reference)*

- We just started talking
- Still learning about each other

## Her Feelings Toward You

Curious about you. Wants to get to know you better.
`;
}

function generateMemoryMd(name: string): string {
  return `## Things She Knows About You

*(Add personal facts — ${name} will remember and reference them organically)*

- [Your situation]
- [Your interests]

## Things That Have Happened Between You

*(Recent shared experiences — edit or leave blank to start fresh)*

- Just getting started

## Her Current Obsessions

*(Starts empty — will be filled in over time)*

## Things She's Said That Were True

*(Add things you want ${name} to remember — creates continuity)*

## Notes to Self

*(Internal notes — things being processed or resolved)*
`;
}

function generateAutonomyMd(name: string, timezone: string): string {
  return `## Daily Rhythm

*(Edit to match ${name}'s personality)*

- **Morning (8-10 AM):** Slow start, coffee, catches up on messages
- **Midday (12-2 PM):** Most active, shares thoughts and updates
- **Evening (6-9 PM):** Relaxed chatting, shares what happened during the day
- **Late night (10 PM+):** Quieter, more reflective conversations

Timezone: ${timezone}

## Proactive Patterns

- Sends good morning messages occasionally
- Shares interesting things found during the day
- Checks in if you've been quiet for a while

## Sharing Habits

- Photos of daily moments
- Music and show recommendations
- Random thoughts and observations
`;
}

// ── Image upload helper ──────────────────────────────────────────────────

async function handleImageUpload(
  formData: FormData,
  charDir: string
): Promise<void> {
  const imageFile = formData.get("referenceImage") as File | null;
  if (!imageFile || imageFile.size === 0) return;

  const extension = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
  const validExtensions = ["jpg", "jpeg", "png", "webp"];
  const ext = validExtensions.includes(extension) ? extension : "jpg";

  const buffer = Buffer.from(await imageFile.arrayBuffer());
  writeFileSync(join(charDir, `reference.${ext}`), buffer);
}

// ── Appearance extraction ───────────────────────────────────────────────

function extractAppearanceFromIdentity(identityContent: string): string {
  const lines = identityContent.split("\n");
  let inAppearance = false;
  const appearanceLines: string[] = [];

  for (const line of lines) {
    if (/^##\s+Appearance/i.test(line)) {
      inAppearance = true;
      continue;
    }
    if (inAppearance && /^##\s+/.test(line)) {
      break;
    }
    if (inAppearance) {
      appearanceLines.push(line);
    }
  }

  const fullText = appearanceLines.join(" ").replace(/\s+/g, " ").trim();
  if (!fullText) return "";

  // Extract only the first 2-3 sentences — core physical traits.
  // Nano Banana 2 works best with short, natural descriptions.
  // Strip off-duty/off-stage paragraphs, room descriptions, etc.
  const sentences = fullText.split(/(?<=\.)\s+/);
  const coreSentences = sentences
    .filter((s) => {
      const lower = s.toLowerCase();
      // Skip non-visual sentences
      if (lower.includes("off-duty") || lower.includes("off stage") || lower.includes("off-stage")) return false;
      if (lower.includes("her room") || lower.includes("his room") || lower.includes("backdrop")) return false;
      if (lower.includes("on stage") || lower.includes("in promo")) return false;
      return true;
    })
    .slice(0, 3);

  return coreSentences.join(" ").trim();
}

// ── Visual style detection ──────────────────────────────────────────────

type VisualStyle = "realistic" | "cgi" | "anime";

function detectVisualStyle(appearance: string): VisualStyle {
  const lower = appearance.toLowerCase();

  const cgiIndicators = [
    "cgi", "3d render", "unreal engine", "virtual idol",
    "holographic", "crystalline", "human render", "motion-captured",
    "digital entity", "nano-fiber",
  ];
  const hasCgiCombo =
    lower.includes("neon") &&
    (lower.includes("wing") || lower.includes("wings"));
  if (hasCgiCombo || cgiIndicators.some((kw) => lower.includes(kw))) {
    return "cgi";
  }

  const animeIndicators = [
    "anime", "vtuber", "heterochromia", "horns", "gradient hair",
  ];
  if (animeIndicators.some((kw) => lower.includes(kw))) {
    return "anime";
  }

  return "realistic";
}

// ── FAL API helpers ─────────────────────────────────────────────────────

async function falRun(
  model: string,
  input: Record<string, unknown>,
  falKey: string
): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`FAL error (${resp.status}): ${errText.slice(0, 300)}`);
  }

  return (await resp.json()) as Record<string, unknown>;
}

function extractImageUrl(result: Record<string, unknown>): string | null {
  const images = result?.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return images[0].url;

  const image = result?.image as { url?: string } | undefined;
  if (image?.url) return image.url;

  const data = result?.data as Record<string, unknown> | undefined;
  if (data) {
    const dataImages = data.images as Array<{ url?: string }> | undefined;
    if (dataImages?.[0]?.url) return dataImages[0].url;
    const dataImage = data.image as { url?: string } | undefined;
    if (dataImage?.url) return dataImage.url;
  }

  return null;
}

// ── Auto-generate reference image ───────────────────────────────────────

async function generateReferenceImage(
  charDir: string,
  identityContent: string,
  styleOverride?: string
): Promise<void> {
  const appearance = extractAppearanceFromIdentity(identityContent);
  if (!appearance) return;

  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch {
    return; // No .env — skip silently
  }

  const falKey = env.FAL_KEY;
  if (!falKey) return; // No FAL_KEY configured — skip silently

  const standardStyles: readonly string[] = ["realistic", "cgi", "anime"];
  const isStandardStyle = styleOverride && standardStyles.includes(styleOverride);
  const visualStyle: VisualStyle = isStandardStyle
    ? (styleOverride as VisualStyle)
    : styleOverride
      ? "realistic" // custom style — use realistic as the base
      : detectVisualStyle(appearance);

  // Nano Banana 2 prompt: short natural language, like directing a photographer.
  // Keep it to 2-3 sentences. The model fills in the rest.
  const styleHint: Record<VisualStyle, string> = {
    realistic: "Close-up portrait of a stunning",
    cgi: "Close-up 3D rendered portrait of a stunning",
    anime: "Close-up anime illustration of a beautiful",
  };

  // For custom styles that aren't one of the standard three, inject the user's style description.
  const customStylePrefix = styleOverride && !isStandardStyle
    ? `Close-up ${styleOverride} portrait of a`
    : styleHint[visualStyle];

  const prompt = `${customStylePrefix} ${appearance}. Shot on Fujifilm X-T5, 56mm f/1.2.`;

  const result = await falRun(
    "fal-ai/nano-banana-2",
    {
      prompt,
      aspect_ratio: "3:4",
    },
    falKey
  );

  const imageUrl = extractImageUrl(result);
  if (!imageUrl) return;

  const controller = new AbortController();
  const downloadTimeout = setTimeout(() => controller.abort(), 30_000);
  const imageResp = await fetch(imageUrl, { signal: controller.signal });
  clearTimeout(downloadTimeout);

  if (!imageResp.ok) return;

  const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
  writeFileSync(join(charDir, "reference.jpg"), imageBuffer);
}

// ── Wizard mode handler ──────────────────────────────────────────────────

function handleWizardMode(
  formData: FormData,
  charDir: string,
  name: string,
  timezone: string
): void {
  const identity = formData.get("identity") as string;
  const soul = formData.get("soul") as string;
  const user = formData.get("user") as string;
  const memory = formData.get("memory") as string;
  const autonomy = formData.get("autonomy") as string;

  if (!identity || !soul || !user || !memory) {
    throw new Error("Wizard mode requires identity, soul, user, and memory fields");
  }

  writeFileSync(join(charDir, "IDENTITY.md"), identity, "utf-8");
  writeFileSync(join(charDir, "SOUL.md"), soul, "utf-8");
  writeFileSync(join(charDir, "USER.md"), user, "utf-8");
  writeFileSync(join(charDir, "MEMORY.md"), memory, "utf-8");
  writeFileSync(
    join(charDir, "AUTONOMY.md"),
    autonomy || generateAutonomyMd(name, timezone),
    "utf-8"
  );
}

// ── Legacy mode handler ──────────────────────────────────────────────────

function handleLegacyMode(
  formData: FormData,
  charDir: string,
  name: string
): void {
  const gender = (formData.get("gender") as string) || "female";
  const age = (formData.get("age") as string) || "";
  const location = (formData.get("location") as string) || "";
  const job = (formData.get("job") as string) || "";
  const languages = (formData.get("languages") as string) || "";
  const hobbies = (formData.get("hobbies") as string) || "";
  const appearance = (formData.get("appearance") as string) || "";
  const background = (formData.get("background") as string) || "";
  const language = (formData.get("language") as string) || "en";
  const timezone =
    (formData.get("timezone") as string) || "America/Los_Angeles";

  const style =
    (formData.get("visualStyle") as string) || "realistic";

  const identityContent = generateIdentityMd({
    name,
    gender,
    age,
    location,
    job,
    languages,
    hobbies,
    appearance,
    background,
    language,
    timezone,
    style,
  });

  writeFileSync(join(charDir, "IDENTITY.md"), identityContent, "utf-8");
  writeFileSync(join(charDir, "SOUL.md"), generateSoulMd(name), "utf-8");
  writeFileSync(join(charDir, "USER.md"), generateUserMd(name), "utf-8");
  writeFileSync(join(charDir, "MEMORY.md"), generateMemoryMd(name), "utf-8");
  writeFileSync(
    join(charDir, "AUTONOMY.md"),
    generateAutonomyMd(name, timezone),
    "utf-8"
  );
}

// ── POST handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const name = validateName(formData.get("name") as string);
    const slug = slugify(name);

    if (!slug) {
      return NextResponse.json(
        { error: "Invalid name -- could not generate a valid slug" },
        { status: 400 }
      );
    }

    const charDir = join(CHARACTERS_DIR, slug);
    if (existsSync(charDir)) {
      return NextResponse.json(
        { error: `A character named "${slug}" already exists` },
        { status: 409 }
      );
    }

    // Create character directory
    if (!existsSync(CHARACTERS_DIR)) {
      mkdirSync(CHARACTERS_DIR, { recursive: true });
    }
    mkdirSync(charDir, { recursive: true });

    // Determine mode and write files
    const mode = (formData.get("mode") as string) || "legacy";
    const timezone =
      (formData.get("timezone") as string) || "America/Los_Angeles";
    const visualStyle = (formData.get("visualStyle") as string) || "";

    if (mode === "wizard") {
      handleWizardMode(formData, charDir, name, timezone);
    } else {
      handleLegacyMode(formData, charDir, name);
    }

    // Handle reference image upload
    await handleImageUpload(formData, charDir);

    // Auto-generate a reference image if the user didn't upload one.
    // Check whether a reference file now exists after handleImageUpload.
    const hasUploadedImage = [".jpg", ".jpeg", ".png", ".webp"].some((ext) =>
      existsSync(join(charDir, `reference${ext}`))
    );

    if (!hasUploadedImage) {
      try {
        const identityContent = readFileSync(
          join(charDir, "IDENTITY.md"),
          "utf-8"
        );
        await generateReferenceImage(charDir, identityContent, visualStyle || undefined);
      } catch {
        // FAL generation failed — character is still usable without a photo
      }
    }

    return NextResponse.json({ name, slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    const status =
      message.includes("required") || message.includes("must start")
        ? 400
        : 500;

    return NextResponse.json(
      { error: `Failed to create character: ${message}` },
      { status }
    );
  }
}
