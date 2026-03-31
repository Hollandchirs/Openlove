import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { findRepoRoot, parseEnv } from "@/lib/repo-root";

export const dynamic = "force-dynamic";

// ── Token budget ─────────────────────────────────────────────────────────
// 5 markdown files + 3 preview fields in a single JSON blob require at
// least 6000-8000 tokens.  4096 was the original value and caused
// truncation — the model hit the limit mid-JSON and fields arrived thin
// or the response was malformed entirely.
const GENERATION_MAX_TOKENS = 8192;

// ── Minimum content thresholds (characters, not tokens) ─────────────────
// Used to detect truncated / thin output so we can retry selectively.
const MIN_CONTENT_LENGTHS: Readonly<Record<string, number>> = {
  identity: 600,
  soul: 800,
  user: 200,
  memory: 150,
  autonomy: 800,
  summary: 40,
  appearancePreview: 40,
  schedulePreview: 30,
};

// ── LLM call abstraction ─────────────────────────────────────────────────

interface LLMCallOptions {
  readonly provider: string;
  readonly model?: string;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens?: number;
}

async function callLLM(opts: LLMCallOptions): Promise<string> {
  const { provider, model, apiKey, systemPrompt, userPrompt } = opts;
  const maxTokens = opts.maxTokens ?? GENERATION_MAX_TOKENS;

  if (provider === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  }

  // All OpenAI-compatible providers
  const baseURLMap: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    deepseek: "https://api.deepseek.com",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    kimi: "https://api.moonshot.cn/v1",
    zhipu: "https://open.bigmodel.cn/api/paas/v4",
    minimax: "https://api.minimaxi.com/v1",
    "minimax-global": "https://api.minimax.io/v1",
    zai: "https://api.lingyiwanwu.com/v1",
    ollama: "http://localhost:11434/v1",
  };

  const defaultModelMap: Record<string, string> = {
    openai: "gpt-4o",
    xai: "grok-3-mini-fast-latest",
    deepseek: "deepseek-chat",
    qwen: "qwen-max",
    kimi: "moonshot-v1-8k",
    zhipu: "glm-4-flash",
    minimax: "MiniMax-Text-01",
    "minimax-global": "MiniMax-Text-01",
    zai: "yi-lightning",
    ollama: "qwen2.5:7b",
  };

  const baseURL = baseURLMap[provider];
  if (baseURL === undefined) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: apiKey || "no-key",
    baseURL: baseURL || undefined,
  });

  const response = await client.chat.completions.create({
    model: model || defaultModelMap[provider] || "gpt-4o",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}

// ── Request validation ───────────────────────────────────────────────────

interface GeneratePreviewInput {
  readonly name: string;
  readonly gender: string;
  readonly description: string;
  readonly personalityTags: readonly string[];
  readonly language: string;
  readonly timezone: string;
  readonly visualStyle: string;
}

function validateInput(body: unknown): GeneratePreviewInput {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid request body");
  }

  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    throw new Error("Name is required");
  }

  const gender = typeof b.gender === "string" ? b.gender : "female";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!description) {
    throw new Error("Description is required");
  }
  if (description.length > 500) {
    throw new Error("Description too long (max 500 chars)");
  }

  const personalityTags = Array.isArray(b.personalityTags)
    ? b.personalityTags.filter((t): t is string => typeof t === "string")
    : [];

  const language = typeof b.language === "string" ? b.language : "en";
  const timezone = typeof b.timezone === "string" ? b.timezone : "America/Los_Angeles";
  const visualStyle = typeof b.visualStyle === "string" ? b.visualStyle : "realistic";

  return { name, gender, description, personalityTags, language, timezone, visualStyle };
}

// ── Prompt builder ───────────────────────────────────────────────────────

function buildPrompts(input: GeneratePreviewInput): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  const tagsStr =
    input.personalityTags.length > 0
      ? input.personalityTags.join(", ")
      : "no specific tags selected";

  const pronoun = input.gender === "male" ? "He" : "She";
  const possessive = input.gender === "male" ? "His" : "Her";

  const systemPrompt = `You are a creative character designer for an AI companion platform called Opencrush.
You generate rich, nuanced character profiles from minimal user input.
Always write in second person when describing the character's behavior ("she does X" / "he does X").
Be EXTREMELY specific and vivid. Avoid generic descriptions.
NEVER use generic interests like "music" or "cooking" — be specific like "Shin Ramyun tier lists" or "3AM sketches of strangers."
Output valid JSON only, no markdown fences.

CRITICAL: Your output must be COMPLETE. Every section must have real, substantive content.
Do not abbreviate or truncate any section. Each markdown file should be thorough and detailed.`;

  const userPrompt = `Create a full character profile for an AI companion with these basics:

- **Name:** ${input.name}
- **Gender:** ${input.gender}
- **Description:** ${input.description}
- **Personality Tags:** ${tagsStr}
- **Language:** ${input.language}
- **Timezone:** ${input.timezone}

Return a JSON object with exactly these keys. EVERY file must have SUBSTANTIAL content — not placeholders.

1. "identity" — A complete IDENTITY.md file in markdown (at least 30 lines). Include:
   - YAML frontmatter (gender, language, timezone, style: ${input.visualStyle}, evil mode: false)
   - H1 heading with character name
   - Bullet points for Age, From, Job, Languages, Hobbies (6-8 specific hobbies with texture)
   - ## Appearance (2-3 paragraphs with SPECIFIC details: hair, face, body language, fashion, sensory details)
   - ## Background (3-5 paragraphs with specific origin story, family dynamics, defining moments)

2. "soul" — A complete SOUL.md file in markdown (at least 50 lines). MUST include ALL of these sections with substantive content:
   - ## Voice & Vibe (1-2 paragraphs describing communication style and texting behavior)
   - ## Loves (6-8 bullet points, each with WHY they love it, minimum 20 characters per bullet)
   - ## Dislikes (6-8 bullet points, specific and character-revealing)
   - ## Emotional Patterns (6-8 states: default, comfortable, excited, sad, overwhelmed, flirty — describe TEXTING behavior for each)
   - ## Things ${pronoun} Does (8-10 specific observable behaviors)
   - ## Speech Patterns (8-10 exact phrases with context for when they use them)

3. "user" — A complete USER.md file in markdown. Include:
   - ## Starting Relationship Stage — REQUIRED. Must be one of: "Starting relationship: Stranger (Stage 0)" or "Starting relationship: Acquaintance (Stage 1)". For a new character this should always be Stranger (Stage 0).
   - ## How We Met (1-2 sentences, specific scenario)
   - ## What ${pronoun} Calls You (specific nicknames with context)
   - ## Our Dynamic (2-3 sentences describing the early relationship energy)
   - ## Things ${pronoun} Knows About You (3-4 bullet points)
   - ## Our Shared History (2-3 bullet items)
   - ## ${possessive} Feelings Toward You (2-3 sentences from ${input.name}'s perspective)

4. "memory" — A complete MEMORY.md file in markdown. Include:
   - ## Things ${pronoun} Knows About You (3-4 placeholder items in brackets)
   - ## Things That Have Happened Between You (3 placeholder items in brackets)
   - ## ${possessive} Current Obsessions (4-6 specific items tied to the character's interests)
   - ## Things ${pronoun}'s Said That Were True (3-4 revealing quotes)
   - ## Notes to Self (3-4 internal character notes)

5. "autonomy" — A complete AUTONOMY.md file in markdown (at least 40 lines). Include:
   - ## Daily Rhythm (time-bracketed schedule with 4-5 time slots matching personality and timezone ${input.timezone})
   - ## Proactive Messaging Patterns (4 time-of-day categories: Morning, Afternoon, Evening/Night, Late Night — each describing what they send)
   - ## Sharing Habits (4 categories: Photos, Audio, Links, Text — with specific examples)
   - ## Relationship-Gated Behavior — REQUIRED. Must include ALL 5 stages:
     - ### Stranger (Stage 0): No proactive messages, responds only when messaged, communication frequency, emotional depth
     - ### Acquaintance (Stage 1): Communication frequency (e.g. 1 msg/day max), content types shared, emotional depth, terms used
     - ### Friend (Stage 2): Communication frequency (e.g. 2 msgs/day), unlocked content types, emotional depth, pet names/terms
     - ### Close Friend (Stage 3): Communication frequency (e.g. 3 msgs/day), deeper unlocks, emotional vulnerability, pet names
     - ### Intimate (Stage 4): Full vulnerability, pet names/native language, miss-you messages, deepest emotional sharing
   - ## Silence Behavior (escalation at 6h, 24h, 48h, 72h+)
   - ## Anti-Patterns (4-6 rules for what the character NEVER does)

6. "summary" — 2-3 sentence personality summary capturing the character's essence. Third person.

7. "appearancePreview" — 2-3 sentence vivid visual description.

8. "schedulePreview" — Brief daily schedule as a readable list.

Respond with ONLY the JSON object. No explanation, no markdown code fences.`;

  return { systemPrompt, userPrompt };
}

// ── Targeted follow-up prompt for thin fields ───────────────────────────

function buildFollowUpPrompt(
  input: GeneratePreviewInput,
  thinFields: readonly string[],
  existingContent: Record<string, string>
): { readonly systemPrompt: string; readonly userPrompt: string } {
  const pronoun = input.gender === "male" ? "He" : "She";
  const possessive = input.gender === "male" ? "His" : "Her";

  const systemPrompt = `You are a creative character designer. You previously generated a character profile but some sections were too thin.
Your job is to expand ONLY the specified sections with rich, specific, detailed content.
Output valid JSON only.`;

  const fieldInstructions: Record<string, string> = {
    identity: `"identity" — Expand to a full IDENTITY.md: YAML frontmatter (gender, language, timezone, evil mode: false), H1 name heading, bullet points (Age, From, Job, Languages, Hobbies with 6-8 specific items), ## Appearance (2-3 detailed paragraphs), ## Background (3-5 paragraphs). Minimum 30 lines.`,
    soul: `"soul" — Expand to a full SOUL.md with ALL these sections: ## Voice & Vibe (1-2 paragraphs), ## Loves (6-8 detailed bullets), ## Dislikes (6-8 bullets), ## Emotional Patterns (6-8 states with texting behavior), ## Things ${pronoun} Does (8-10 behaviors), ## Speech Patterns (8-10 exact phrases). Minimum 50 lines.`,
    user: `"user" — Expand to a full USER.md: ## Starting Relationship Stage (must be "Starting relationship: Stranger (Stage 0)"), ## How We Met, ## What ${pronoun} Calls You, ## Our Dynamic, ## Things ${pronoun} Knows About You, ## Our Shared History, ## ${possessive} Feelings Toward You.`,
    memory: `"memory" — Expand to a full MEMORY.md: ## Things ${pronoun} Knows About You, ## Things That Have Happened Between You, ## ${possessive} Current Obsessions (specific items), ## Things ${pronoun}'s Said That Were True, ## Notes to Self.`,
    autonomy: `"autonomy" — Expand to a full AUTONOMY.md: ## Daily Rhythm (4-5 time-bracketed slots), ## Proactive Messaging Patterns (Morning/Afternoon/Evening/Late Night), ## Sharing Habits (Photos/Audio/Links/Text with examples), ## Relationship-Gated Behavior with ALL 5 stages (Stranger Stage 0, Acquaintance Stage 1, Friend Stage 2, Close Friend Stage 3, Intimate Stage 4 — each defining communication frequency, content types, emotional depth, pet names/terms), ## Silence Behavior (6h/24h/48h/72h+), ## Anti-Patterns. Minimum 40 lines.`,
    summary: `"summary" — Write a 2-3 sentence personality summary.`,
    appearancePreview: `"appearancePreview" — Write a vivid 2-3 sentence visual description.`,
    schedulePreview: `"schedulePreview" — Write a brief daily schedule as a readable list.`,
  };

  const identityContext = existingContent.identity
    ? `\n\nExisting IDENTITY.md for context:\n${existingContent.identity.slice(0, 1500)}`
    : "";
  const soulContext = existingContent.soul
    ? `\n\nExisting SOUL.md for context:\n${existingContent.soul.slice(0, 1500)}`
    : "";

  const instructions = thinFields
    .map((f) => fieldInstructions[f] ?? `"${f}" — Expand with rich content.`)
    .join("\n\n");

  const userPrompt = `The character ${input.name} (${input.gender}, ${input.description}) needs these sections expanded because they were too thin:

${instructions}
${identityContext}${soulContext}

Return a JSON object with ONLY the keys that need expanding: ${thinFields.map((f) => `"${f}"`).join(", ")}.
Each value must be a complete, detailed markdown string. Be specific and vivid.

Respond with ONLY the JSON object. No explanation, no markdown code fences.`;

  return { systemPrompt, userPrompt };
}

// ── JSON extraction with truncation recovery ────────────────────────────

function extractJSON(raw: string): Record<string, unknown> {
  // Strip markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {
    // Noop — try recovery below
  }

  // Attempt to find the JSON object boundaries
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("LLM response contains no JSON object");
  }

  let jsonCandidate = cleaned.slice(firstBrace);

  // Try parsing as-is (maybe there's trailing text after the closing brace)
  const lastBrace = jsonCandidate.lastIndexOf("}");
  if (lastBrace > 0) {
    try {
      return JSON.parse(jsonCandidate.slice(0, lastBrace + 1));
    } catch {
      // Noop — try repair below
    }
  }

  // Truncation recovery: the JSON was cut off mid-string.
  // Try to close any open string, then close all open braces/brackets.
  let repaired = jsonCandidate;

  // If we're inside a string value (odd number of unescaped quotes), close it
  const unescapedQuotes = (repaired.match(/(?<!\\)"/g) ?? []).length;
  if (unescapedQuotes % 2 !== 0) {
    repaired += '"';
  }

  // Close any open arrays/objects
  const opens = (repaired.match(/[{[]/g) ?? []).length;
  const closes = (repaired.match(/[}\]]/g) ?? []).length;
  const needed = opens - closes;
  for (let i = 0; i < needed; i++) {
    repaired += "}";
  }

  try {
    return JSON.parse(repaired);
  } catch {
    throw new Error(
      "LLM response is not valid JSON and could not be repaired. The output may have been truncated."
    );
  }
}

// ── Thin-content detection ──────────────────────────────────────────────

function findThinFields(parsed: Record<string, string>): readonly string[] {
  const thin: string[] = [];
  for (const [key, minLen] of Object.entries(MIN_CONTENT_LENGTHS)) {
    const value = parsed[key];
    if (typeof value !== "string" || value.trim().length < minLen) {
      thin.push(key);
    }
  }
  return thin;
}

// ── Resolve API key ──────────────────────────────────────────────────────

function resolveApiKey(
  provider: string,
  env: Record<string, string>
): string {
  const keyMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    qwen: "DASHSCOPE_API_KEY",
    kimi: "MOONSHOT_API_KEY",
    zhipu: "ZHIPU_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-global": "MINIMAX_GLOBAL_API_KEY",
    zai: "ZAI_API_KEY",
    ollama: "",
  };

  const envKey = keyMap[provider];
  if (envKey === undefined) {
    throw new Error(`No API key mapping for provider: ${provider}`);
  }

  // Ollama doesn't need an API key
  if (provider === "ollama") {
    return "ollama";
  }

  const key = env[envKey]?.trim();
  if (!key) {
    throw new Error(
      `No API key found for provider "${provider}". Set ${envKey} in your .env file.`
    );
  }

  return key;
}

// ── POST handler ─────────────────────────────────────────────────────────

const REQUIRED_KEYS = [
  "identity",
  "soul",
  "user",
  "memory",
  "autonomy",
  "summary",
  "appearancePreview",
  "schedulePreview",
] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = validateInput(body);

    // Read .env to get LLM config
    const repoRoot = findRepoRoot();
    const envPath = join(repoRoot, ".env");
    const env = parseEnv(readFileSync(envPath, "utf-8"));

    const provider = env.LLM_PROVIDER?.trim() || "anthropic";
    const model =
      env.LLM_MODEL && env.LLM_MODEL !== "(provider default)"
        ? env.LLM_MODEL
        : undefined;
    const apiKey = resolveApiKey(provider, env);

    const llmOpts = { provider, model, apiKey };

    // ── Step 1: Initial generation ────────────────────────────────────
    const { systemPrompt, userPrompt } = buildPrompts(input);
    const rawResponse = await callLLM({
      ...llmOpts,
      systemPrompt,
      userPrompt,
      maxTokens: GENERATION_MAX_TOKENS,
    });

    const parsed = extractJSON(rawResponse) as Record<string, string>;

    // Validate required fields exist (even if thin)
    for (const key of REQUIRED_KEYS) {
      if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
        throw new Error(`LLM response missing or empty field: ${key}`);
      }
    }

    // ── Step 2: Detect thin fields and retry if needed ────────────────
    const thinFields = findThinFields(parsed);

    if (thinFields.length > 0) {
      console.warn(
        `[generate-preview] Thin content detected in: ${thinFields.join(", ")}. Running follow-up generation.`
      );

      const followUp = buildFollowUpPrompt(input, thinFields, parsed);
      const followUpResponse = await callLLM({
        ...llmOpts,
        systemPrompt: followUp.systemPrompt,
        userPrompt: followUp.userPrompt,
        maxTokens: GENERATION_MAX_TOKENS,
      });

      try {
        const expanded = extractJSON(followUpResponse) as Record<string, string>;

        // Merge expanded fields into parsed, only if the new content is longer
        for (const key of thinFields) {
          const expandedValue = expanded[key];
          if (
            typeof expandedValue === "string" &&
            expandedValue.trim().length > (parsed[key]?.trim().length ?? 0)
          ) {
            parsed[key] = expandedValue;
          }
        }
      } catch (followUpError) {
        // Follow-up failed — log and continue with original (thin) content
        // rather than failing the entire request.
        console.warn(
          "[generate-preview] Follow-up generation failed, using original content:",
          followUpError instanceof Error ? followUpError.message : "Unknown error"
        );
      }
    }

    return NextResponse.json({
      identity: parsed.identity,
      soul: parsed.soul,
      user: parsed.user,
      memory: parsed.memory,
      autonomy: parsed.autonomy,
      summary: parsed.summary,
      appearancePreview: parsed.appearancePreview,
      schedulePreview: parsed.schedulePreview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[generate-preview] Error:", message);

    const status =
      message.includes("required") || message.includes("Invalid")
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
