import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { engineCache } from "@/lib/engine-cache";
import { CHARACTERS_DIR, ENV_PATH, readEnvCached } from "@/lib/repo-root";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cached MD file reader — avoids re-reading on every request.
 * TTL: 10 minutes (character files are static during normal use).
 */
const mdCache = new Map<string, { content: string; timestamp: number }>();
const MD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Remove expired entries from a TTL cache on each access. */
function cleanExpiredEntries<V extends { timestamp: number }>(
  cache: Map<string, V>,
  ttl: number
): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= ttl) {
      cache.delete(key);
    }
  }
}

function readMdCached(filePath: string): string {
  cleanExpiredEntries(mdCache, MD_CACHE_TTL);
  const cached = mdCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < MD_CACHE_TTL) {
    return cached.content;
  }
  if (!existsSync(filePath)) return "";
  const content = readFileSync(filePath, "utf-8");
  mdCache.set(filePath, { content, timestamp: Date.now() });
  return content;
}

/** Backward-compat alias so existing callers still work. */
function readIdentityCached(identityPath: string): string {
  return readMdCached(identityPath);
}

// ── Extract appearance from IDENTITY.md ─────────────────────────────────

function extractAppearance(identityContent: string): string {
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

  // Filter out stage/performance costume paragraphs — these confuse
  // image models when generating casual selfies. Keep only paragraphs
  // about the character's natural appearance and off-stage look.
  const fullText = appearanceLines.join(" ").replace(/\s+/g, " ").trim();
  const sentences = fullText.split(/(?<=\.)\s+/);
  const filtered = sentences.filter((s) => {
    const lower = s.toLowerCase();
    // Skip stage/performance costume descriptions
    if (
      lower.includes("on stage") ||
      lower.includes("in promo") ||
      lower.includes("stage rig") ||
      lower.includes("during performance") ||
      lower.includes("projecting from") ||
      lower.includes("pulse to the beat") ||
      lower.includes("crystalline") ||
      lower.includes("holographic") && lower.includes("cape")
    ) {
      return false;
    }
    return true;
  });

  // Cap at 350 chars to keep prompt focused — key visual traits are
  // already extracted separately via extractKeyVisualTraits()
  const result = filtered.join(" ").trim();
  return result.length > 350 ? result.slice(0, 347) + "..." : result;
}

/**
 * Extract the most visually distinctive features from the Appearance section.
 * Placed at the FRONT of the prompt so image models prioritize them.
 * Focuses on: hair color/style, eye color, skin tone, and unique markings.
 */
function extractKeyVisualTraits(identityContent: string): string {
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

  const text = appearanceLines.join("\n");
  const traits: string[] = [];

  // Hair description (most visually impactful)
  const hairPatterns = [
    /(?:shaved|bald|buzz\s*cut|close-cropped)[^.]*/gi,
    /(?:hair|hair color)[^.]*(?:black|blonde|brunette|red|silver|lavender|pink|blue|purple|white|platinum|auburn|copper|ombre|gradient|holographic|ash)[^.]*\./gi,
    /(?:black|blonde|brunette|red|silver|lavender|pink|blue|purple|white|platinum|auburn|copper|ash)[^.]*hair[^.]*/gi,
    /(?:sleek|long|short|waist-length|shoulder-length|cropped|wolf\s*cut|textured)[^.]*hair[^.]*/gi,
  ];
  for (const pattern of hairPatterns) {
    const match = text.match(pattern);
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ""));
      break;
    }
  }

  // Eye description
  const eyePatterns = [
    /(?:eyes?|pupils?)[^.]*(?:brown|blue|green|hazel|amber|crimson|violet|heterochromia|feline|almond|dark|monolid|narrow|sleepy)[^.]*/gi,
    /(?:brown|blue|green|hazel|amber|crimson|violet|feline|sharp|dark almond|monolid|narrow)[^.]*eyes?[^.]*/gi,
  ];
  for (const pattern of eyePatterns) {
    const match = text.match(pattern);
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ""));
      break;
    }
  }

  // Skin description
  const skinMatch =
    text.match(
      /(?:skin|complexion)[^.]*(?:pale|dark|tan|sun-kissed|luminous|warm|olive|fair|ebony|porcelain|rich|blue-black)[^.]*/i
    ) ??
    text.match(
      /(?:pale|dark|tan|sun-kissed|luminous|warm|olive|fair|ebony|porcelain|rich)[^.]*skin[^.]*/i
    );
  if (skinMatch) {
    traits.push(skinMatch[0].trim().replace(/\.$/, ""));
  }

  // Distinctive markings (vitiligo, tattoos, scars, beauty marks, piercings)
  const markingPatterns = [
    /vitiligo[^.]*/gi,
    /(?:tattoo|tattooed)[^.]*/gi,
    /scar[^.]*/gi,
    /beauty\s*marks?[^.]*/gi,
    /(?:neon[- ]?pink\s+)?triangle\s+marking[^.]*/gi,
    /piercing[^.]*/gi,
  ];
  for (const pattern of markingPatterns) {
    const match = text.match(pattern);
    if (match) {
      traits.push(match[0].trim().replace(/\.$/, ""));
    }
  }

  return traits.join(", ");
}

// ── Character selfie context — dynamic prompt from ALL MD files ─────────

interface CharacterSelfieContext {
  appearance: string;       // physical traits (from extractAppearance)
  keyTraits: string;        // hair/eye/skin/markings emphasis (from extractKeyVisualTraits)
  outfit: string;           // context-appropriate clothing
  props: string;            // character-specific items in scene
  setting: string;          // environment hints
  visualStyle: VisualStyle; // realistic/cgi/anime
}

/** Extract a markdown ## section by heading name. Returns the full text between headings. */
function extractSection(content: string, headingName: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (new RegExp(`^##\\s+${headingName}`, "i").test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n").trim();
}

/** Extract the frontmatter bullet value for a given key (e.g., "Hobbies", "Job"). */
function extractFrontmatterField(identityContent: string, fieldName: string): string {
  const pattern = new RegExp(
    `^-\\s*\\*\\*${fieldName}:\\*\\*\\s*(.+)$`,
    "im"
  );
  const match = identityContent.match(pattern);
  return match?.[1]?.trim() ?? "";
}

/** Extract all dash-prefixed list items from a section's text. */
function extractListItems(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s+/, "").trim());
}

/**
 * Map hobbies to plausible visual props.
 * Returns an array of prop descriptions derived from hobby keywords.
 */
function hobbiesToProps(hobbiesText: string): string[] {
  const lower = hobbiesText.toLowerCase();
  const props: string[] = [];

  const hobbyPropMap: ReadonlyArray<{ keywords: string[]; prop: string }> = [
    { keywords: ["sketch", "drawing", "draw"], prop: "sketchbook and pencils" },
    { keywords: ["guitar", "bass guitar"], prop: "guitar" },
    { keywords: ["piano", "keyboard"], prop: "keyboard instrument" },
    { keywords: ["lo-fi", "producing", "beats", "music production", "dj"], prop: "laptop with DAW open" },
    { keywords: ["boxing", "box "], prop: "boxing gloves and wraps" },
    { keywords: ["gaming", "gamer", "valorant", "tekken"], prop: "gaming setup with monitor" },
    { keywords: ["thrift", "vintage"], prop: "vintage clothing finds" },
    { keywords: ["matcha"], prop: "matcha latte" },
    { keywords: ["coffee", "café", "cafe"], prop: "coffee cup" },
    { keywords: ["tea collect", "rare tea"], prop: "tea set with steeping pot" },
    { keywords: ["camera", "photo", "contax"], prop: "film camera" },
    { keywords: ["cook", "baking"], prop: "kitchen utensils and ingredients" },
    { keywords: ["reading", "book", "literature", "poetry"], prop: "book" },
    { keywords: ["film", "movie", "cinema"], prop: "laptop with film playing" },
    { keywords: ["ramen", "noodle"], prop: "bowl of ramen" },
    { keywords: ["sneaker", "nike", "dunk", "shoe"], prop: "sneaker collection" },
    { keywords: ["basketball", "nba"], prop: "basketball" },
    { keywords: ["writing", "lyric", "notebook", "moleskine"], prop: "notebook and pen" },
    { keywords: ["yoga", "meditation"], prop: "yoga mat" },
    { keywords: ["swim", "surf"], prop: "towel and water" },
    { keywords: ["knit", "crochet", "sewing"], prop: "knitting supplies" },
    { keywords: ["paint", "canvas"], prop: "paint palette and canvas" },
    { keywords: ["dance", "choreo", "freestyle"], prop: "practice room mirror" },
    { keywords: ["gundam", "model kit"], prop: "model kit pieces" },
    { keywords: ["mood board", "pinterest"], prop: "mood board collage" },
    { keywords: ["record player", "vinyl"], prop: "vinyl record player" },
    { keywords: ["flower", "floral", "bouquet"], prop: "flower arrangement" },
    { keywords: ["illustration", "illustrat", "art commission"], prop: "drawing tablet and stylus" },
    { keywords: ["streaming", "vtuber", "stream setup"], prop: "streaming setup with ring light and microphone" },
    { keywords: ["radio"], prop: "microphone and headphones" },
    { keywords: ["antique", "collecting", "collector"], prop: "antique pocket watch" },
    { keywords: ["astronomy", "stargazing", "telescope"], prop: "telescope" },
    { keywords: ["cat", "cats", "stray cat"], prop: "cat nearby" },
  ];

  for (const { keywords, prop } of hobbyPropMap) {
    if (keywords.some((kw) => lower.includes(kw))) {
      props.push(prop);
    }
  }

  return props;
}

/**
 * Extract drinks/foods from the Loves section that could appear as props.
 * Looks for patterns like "matcha lattes", "ramen", "tea", specific food/drink nouns.
 */
function lovesToProps(lovesText: string): string[] {
  const props: string[] = [];
  const items = extractListItems(lovesText);

  const drinkFoodPatterns: ReadonlyArray<{ pattern: RegExp; prop: string }> = [
    { pattern: /matcha\s*(?:latte)?s?/i, prop: "matcha latte" },
    { pattern: /oat\s*milk/i, prop: "oat milk drink" },
    { pattern: /coffee/i, prop: "coffee" },
    { pattern: /tea(?:\s*—|\s*–|\s*-|\s*collect)/i, prop: "tea with teapot" },
    { pattern: /ramen/i, prop: "bowl of ramen" },
    { pattern: /ramyeon/i, prop: "cup of ramyeon" },
    { pattern: /convenience\s*store/i, prop: "convenience store snacks" },
    { pattern: /wine/i, prop: "glass of wine" },
    { pattern: /beer/i, prop: "beer" },
    { pattern: /boba|bubble\s*tea/i, prop: "bubble tea" },
    { pattern: /cocktail/i, prop: "cocktail glass" },
    { pattern: /thiéboudienne/i, prop: "plate of thiéboudienne" },
    { pattern: /kimchi\s*jjigae/i, prop: "pot of kimchi jjigae" },
    { pattern: /kimbap/i, prop: "triangle kimbap" },
  ];

  for (const item of items) {
    for (const { pattern, prop } of drinkFoodPatterns) {
      if (pattern.test(item) && !props.includes(prop)) {
        props.push(prop);
      }
    }
  }

  return props;
}

/**
 * Extract signature carried items from the Appearance section.
 * Characters often carry distinctive items (e.g., Luna's "Contax T3 around her neck")
 * that should appear as props in selfies.
 */
function appearanceToProps(appearanceText: string): string[] {
  const props: string[] = [];
  const lower = appearanceText.toLowerCase();

  const signatureItemPatterns: ReadonlyArray<{ pattern: RegExp; prop: string }> = [
    { pattern: /contax[^.]*(?:around|on|hanging)/i, prop: "vintage film camera around neck" },
    { pattern: /camera[^.]*(?:around|on|hanging)\s*(?:her|his)?\s*neck/i, prop: "vintage film camera around neck" },
    { pattern: /pocket\s*watch[^.]*(?:chain|necklace)/i, prop: "antique pocket watch on chain" },
    { pattern: /(?:silver|gold)\s*rings?\s*on\s*(?:almost\s+)?every\s*finger/i, prop: "thin silver rings on fingers" },
  ];

  for (const { pattern, prop } of signatureItemPatterns) {
    if (pattern.test(lower)) {
      props.push(prop);
    }
  }

  return props;
}

/**
 * Extract habitual actions from "Things She/He Does" that suggest visual elements.
 * E.g., "takes golden hour selfies" → golden hour lighting hint,
 * "carries Contax T3 camera" → camera prop.
 */
function thingsToVisualHints(thingsText: string): string[] {
  const hints: string[] = [];
  const items = extractListItems(thingsText);

  const hintPatterns: ReadonlyArray<{ pattern: RegExp; hint: string }> = [
    { pattern: /golden\s*hour\s*selfie/i, hint: "golden hour warm lighting" },
    { pattern: /contax|film\s*camera|camera/i, hint: "film camera nearby" },
    { pattern: /mirror\s*selfie/i, hint: "practice room mirror" },
    { pattern: /voice\s*note.*walk/i, hint: "earbuds in, walking" },
    { pattern: /sketch|draw/i, hint: "sketchbook open nearby" },
    { pattern: /boxing\s*wrap|gym\s*mirror/i, hint: "boxing wraps on hands" },
    { pattern: /cooking|cook/i, hint: "kitchen setting with food" },
    { pattern: /laptop.*behind.*counter|beats.*counter/i, hint: "laptop open on counter" },
    { pattern: /tea.*ceremon|steep|brew/i, hint: "tea brewing setup" },
    { pattern: /museum|gallery|painting/i, hint: "art gallery background" },
    { pattern: /heels.*cobblestone|walking.*paris/i, hint: "European street backdrop" },
    { pattern: /poetry|notebook.*midnight/i, hint: "notebook with handwriting" },
    { pattern: /practice\s*room|choreo|dance/i, hint: "practice room with mirrors" },
    { pattern: /convenience\s*store/i, hint: "convenience store interior" },
    { pattern: /earbuds?|headphone/i, hint: "earbuds in ears" },
    { pattern: /playlist|music/i, hint: "phone with music app visible" },
  ];

  for (const item of items) {
    for (const { pattern, hint } of hintPatterns) {
      if (pattern.test(item) && !hints.includes(hint)) {
        hints.push(hint);
      }
    }
  }

  return hints;
}

/**
 * Parse the activity schedule to determine what the character would be doing
 * at a given hour, and thus what they'd be wearing and where they'd be.
 */
function parseActivityForHour(
  autonomyText: string,
  hour: number
): { activity: string; location: string } {
  const lower = autonomyText.toLowerCase();

  // Extract schedule blocks: peak, warm, quiet, and any specific time ranges
  const timeBlocks: Array<{
    startHour: number;
    endHour: number;
    description: string;
  }> = [];

  // Match patterns like "4pm-8pm (description)" or "10am-1pm (description)"
  const schedulePattern =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = schedulePattern.exec(lower)) !== null) {
    let startH = parseInt(match[1], 10);
    const startAmPm = match[3];
    let endH = parseInt(match[4], 10);
    const endAmPm = match[6];
    const desc = match[7].trim();

    if (startAmPm === "pm" && startH !== 12) startH += 12;
    if (startAmPm === "am" && startH === 12) startH = 0;
    if (endAmPm === "pm" && endH !== 12) endH += 12;
    if (endAmPm === "am" && endH === 12) endH = 0;

    timeBlocks.push({ startHour: startH, endHour: endH, description: desc });
  }

  // Find matching block for the current hour
  for (const block of timeBlocks) {
    const { startHour, endHour, description } = block;
    const inRange =
      startHour <= endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour; // wraps midnight
    if (inRange) {
      // Derive location from description keywords
      const loc = deriveLocationFromDescription(description);
      return { activity: description, location: loc };
    }
  }

  // Fallback: guess from hour
  if (hour >= 0 && hour < 7) {
    return { activity: "sleeping or resting", location: "bedroom" };
  }
  if (hour >= 7 && hour < 12) {
    return { activity: "morning routine", location: "home" };
  }
  if (hour >= 12 && hour < 18) {
    return { activity: "daytime activities", location: "out" };
  }
  return { activity: "evening wind-down", location: "home" };
}

function deriveLocationFromDescription(description: string): string {
  const lower = description.toLowerCase();
  if (/studio|producing|beats|daw/i.test(lower)) return "music studio";
  if (/practice\s*room|dance|choreo/i.test(lower)) return "practice room";
  if (/convenience\s*store|gs25/i.test(lower)) return "convenience store";
  if (/gym|boxing/i.test(lower)) return "gym";
  if (/cafe|coffee\s*shop/i.test(lower)) return "cafe";
  if (/thrift|shopping/i.test(lower)) return "thrift shop";
  if (/museum|gallery/i.test(lower)) return "museum";
  if (/home|bedroom|apartment|room|couch|sleep/i.test(lower)) return "home";
  if (/walk|river|street|park/i.test(lower)) return "outdoors";
  if (/set|shoot|runway|stage|perform/i.test(lower)) return "stage/set";
  return "indoors";
}

/**
 * Determine the appropriate outfit based on character's identity, current activity,
 * and time of day. Reads from Appearance + Hobbies + Job + schedule context.
 */
function determineOutfit(
  identityContent: string,
  activity: string,
  _timeHour: number,
  sceneContext: string
): string {
  const appearanceSection = extractSection(identityContent, "Appearance");
  const lowerAppearance = appearanceSection.toLowerCase();
  const lowerScene = sceneContext.toLowerCase();
  const lowerActivity = activity.toLowerCase();

  // Check if scene context overrides (e.g., LLM said "in pajamas", "in a dress")
  if (
    /pajama|sleepwear|nightgown|robe.*sleep|pjs/i.test(lowerScene)
  ) {
    return "wearing comfortable sleepwear, relaxed";
  }

  // Determine context category
  const isSleeping = /sleep|bed|waking\s*up|pajama|pillow|blanket|resting.*bed/i.test(
    lowerScene + " " + lowerActivity
  );
  const isPerformance =
    /stage|concert|perform|show|promo|runway|showcase|evaluation/i.test(
      lowerScene + " " + lowerActivity
    );
  const isWorking =
    /work|office|desk|design|laptop.*working|studio.*work/i.test(
      lowerScene + " " + lowerActivity
    );
  const isExercising = /gym|boxing|workout|training|exercise|practice\s*room|dance\s*practice/i.test(
    lowerScene + " " + lowerActivity
  );

  if (isSleeping) {
    return "wearing comfortable sleepwear, relaxed";
  }

  // Extract stage/performance outfit from appearance
  if (isPerformance) {
    const stageMatch = appearanceSection.match(
      /on stage[^:]*:\s*([^.]+(?:\.[^.]+){0,2})/i
    );
    if (stageMatch) {
      return `wearing ${stageMatch[1].trim()}`;
    }
    // Check for performance/promo outfit mentions
    const promoMatch = appearanceSection.match(
      /(?:in promo|during performance|stage rig)[^.]*:\s*([^.]+)/i
    );
    if (promoMatch) {
      return `wearing ${promoMatch[1].trim()}`;
    }
  }

  // Extract exercise/training outfit
  if (isExercising) {
    const trainingMatch = appearanceSection.match(
      /(?:in the practice room|training)[^:]*:\s*([^.]+)/i
    );
    if (trainingMatch) {
      return `wearing ${trainingMatch[1].trim()}`;
    }
    // Generic exercise outfit from appearance cues
    if (/tank\s*top|jogger|training\s*cloth/i.test(lowerAppearance)) {
      const trainingDesc = appearanceSection.match(
        /(?:tank\s*top|jogger|training\s*cloth)[^.]+/i
      );
      if (trainingDesc) {
        return `wearing ${trainingDesc[0].trim()}`;
      }
    }
    return "wearing athletic training clothes";
  }

  // Extract casual/off-duty outfit (most common case)
  const offDutyMatch = appearanceSection.match(
    /off[- ](?:stage|duty)[^:]*:\s*([^.]+(?:\.[^.]+){0,1})/i
  );
  if (offDutyMatch) {
    return `wearing ${offDutyMatch[1].trim()}`;
  }

  // Look for casual/style description paragraphs
  const casualMatch = appearanceSection.match(
    /(?:casual|off-duty|her style|his style|she dresses|he dresses)[^.]*([^.]+\.)/i
  );
  if (casualMatch) {
    const desc = casualMatch[0].trim();
    if (desc.length > 20 && desc.length < 200) {
      return desc;
    }
  }

  // Working context: look for job-related outfit hints
  if (isWorking) {
    const job = extractFrontmatterField(identityContent, "Job");
    if (/design|ux|art direct/i.test(job)) {
      return "wearing stylish casual workwear";
    }
    if (/model|fashion/i.test(job)) {
      return "wearing elegant casual attire";
    }
    if (/trainee|idol/i.test(job)) {
      return "wearing comfortable training clothes";
    }
    return "wearing casual work clothes";
  }

  // Fallback: return empty and let the model decide
  return "";
}

/**
 * Select props appropriate to the current scene from the full pool of character
 * props (hobbies + loves + habitual actions). Picks 1-2 that fit the context.
 */
function selectSceneProps(
  allProps: string[],
  allHints: string[],
  sceneContext: string,
  activity: string,
  location: string
): string {
  const combined = sceneContext.toLowerCase() + " " + activity.toLowerCase() + " " + location.toLowerCase();

  // Deduplicate: same prop string can appear in both allProps and allHints
  const uniqueItems = [...new Set([...allProps, ...allHints])];

  // Score each prop by relevance to current scene
  const scored: Array<{ item: string; score: number }> = [];

  // Detect sleep context — suppress activity props in bedtime selfies
  const isSleepContext = /sleep|bed|waking\s*up|pajama|pillow|blanket|resting.*bed|nap/i.test(combined);
  const sleepSafeProps = /pillow|blanket|phone|lamp|book|candle|plush|stuffed/i;

  for (const prop of uniqueItems) {
    let score = 0;
    const lowerProp = prop.toLowerCase();

    // When sleeping, heavily penalize activity props and only keep sleep-safe items
    if (isSleepContext) {
      if (sleepSafeProps.test(lowerProp)) {
        score += 2;
      } else {
        // Active props (gaming, laptop, sketchbook, etc.) get suppressed
        score -= 10;
      }
    }

    // Location-based scoring
    if (combined.includes("cafe") || combined.includes("coffee")) {
      if (/coffee|matcha|latte|tea|sketchbook|book|laptop/i.test(lowerProp))
        score += 3;
    }
    if (combined.includes("home") || combined.includes("bedroom") || combined.includes("apartment")) {
      if (/gaming|laptop|book|sketchbook|notebook|tea|record|mood board|vinyl|model kit/i.test(lowerProp))
        score += 3;
    }
    if (combined.includes("gym") || combined.includes("boxing")) {
      if (/boxing|wraps|gloves|gym/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("studio") || combined.includes("producing")) {
      if (/laptop|daw|headphone|notebook|pen/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("practice") || combined.includes("dance")) {
      if (/mirror|earbud|practice|water/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("convenience") || combined.includes("store")) {
      if (/ramen|ramyeon|snack|convenience|laptop/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("museum") || combined.includes("gallery")) {
      if (/art|painting|gallery|book/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("thrift") || combined.includes("shopping")) {
      if (/vintage|clothing|thrift/i.test(lowerProp)) score += 3;
    }
    if (combined.includes("walk") || combined.includes("outdoor") || combined.includes("street")) {
      if (/camera|earbud|phone|earphone/i.test(lowerProp)) score += 2;
    }

    // Always slightly prefer drink/food props (they make selfies feel real)
    if (/latte|coffee|tea|ramen|ramyeon|drink|food|kimbap/i.test(lowerProp)) {
      score += 1;
    }

    // Props directly mentioned in scene context get a big boost
    for (const word of lowerProp.split(/\s+/)) {
      if (word.length > 3 && combined.includes(word)) {
        score += 2;
      }
    }

    if (score > 0) {
      scored.push({ item: prop, score });
    }
  }

  // Sort by score descending, take top 2
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, 2).map((s) => s.item);

  // If nothing matched the scene, pick the first hobby prop as a default
  if (selected.length === 0 && allProps.length > 0) {
    selected.push(allProps[0]);
  }

  return selected.join(", ");
}

/**
 * Build a complete selfie context by reading ALL character MD documents.
 * Extracts personality-relevant visual details dynamically — never hardcodes
 * character-specific items.
 */
function buildCharacterSelfieContext(
  charactersDir: string,
  characterName: string,
  sceneContext: string,
  timeContext: string
): CharacterSelfieContext {
  const charDir = join(charactersDir, characterName);

  // Read all available MD files
  const identityContent = readMdCached(join(charDir, "IDENTITY.md"));
  const soulContent = readMdCached(join(charDir, "SOUL.md"));
  const autonomyContent = readMdCached(join(charDir, "AUTONOMY.md"));
  const memoryContent = readMdCached(join(charDir, "MEMORY.md"));

  // 1. Appearance + key traits (existing extractors)
  const appearance = extractAppearance(identityContent);
  const keyTraits = extractKeyVisualTraits(identityContent);
  const visualStyle = detectVisualStyle(appearance);

  // 2. Determine current hour in character's timezone
  const timezone = extractTimezone(identityContent);
  let currentHour: number;
  try {
    const hourStr = new Date().toLocaleString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    currentHour = parseInt(hourStr, 10);
  } catch {
    currentHour = new Date().getHours();
  }

  // 3. Parse activity schedule from AUTONOMY.md
  const scheduleSection = extractSection(autonomyContent, "Activity Schedule");
  const { activity: scheduledActivity, location: scheduledLocation } =
    parseActivityForHour(scheduleSection, currentHour);

  // 4. Determine outfit from IDENTITY.md appearance + context
  const outfit = determineOutfit(
    identityContent,
    scheduledActivity,
    currentHour,
    sceneContext
  );

  // 5. Collect all possible props from hobbies, loves, and habitual actions
  const hobbies = extractFrontmatterField(identityContent, "Hobbies");
  const lovesSection = extractSection(soulContent, "Loves");
  const thingsSection = extractSection(soulContent, "Things (She|He) Does")
    || extractSection(soulContent, "Things She Does")
    || extractSection(soulContent, "Things He Does");

  const hobbyProps = hobbiesToProps(hobbies);
  const loveProps = lovesToProps(lovesSection);
  const thingsHints = thingsToVisualHints(thingsSection);

  // Also extract props from current obsessions in MEMORY.md
  const obsessionsSection = extractSection(memoryContent, "Her Current Obsessions")
    || extractSection(memoryContent, "His Current Obsessions")
    || extractSection(memoryContent, "Current Obsessions")
    || extractSection(memoryContent, "Current World");
  const obsessionProps = hobbiesToProps(obsessionsSection);

  // Extract signature carried items from Appearance (e.g., Contax T3 camera)
  const appearanceSection = extractSection(identityContent, "Appearance");
  const signatureProps = appearanceToProps(appearanceSection);

  const allProps = [...hobbyProps, ...loveProps, ...obsessionProps, ...signatureProps];
  const allHints = thingsHints;

  // 6. Select scene-appropriate props (1-2 items)
  const props = selectSceneProps(
    allProps,
    allHints,
    sceneContext,
    scheduledActivity,
    scheduledLocation
  );

  // 7. Derive setting hints from schedule location + scene
  const settingParts: string[] = [];
  if (scheduledLocation && scheduledLocation !== "indoors") {
    settingParts.push(scheduledLocation);
  }
  // Add character-specific location flavor from identity.
  // Prefer "currently X" city when present (e.g., "Montpellier (currently Los Angeles)")
  // so the selfie reflects where the character actually lives now.
  const from = extractFrontmatterField(identityContent, "From");
  if (from && /paris|seoul|tokyo|la|los angeles|milan|dakar|new york/i.test(from)) {
    const cityNames = /(?:Paris|Seoul|Tokyo|Los Angeles|LA|Milan|Dakar|New York|London|Montpellier|Kyoto)/i;
    const currentlyMatch = from.match(/currently\s+([^)]+)/i);
    let resolvedCity: string | null = null;
    if (currentlyMatch) {
      const currentCityMatch = currentlyMatch[1].match(cityNames);
      if (currentCityMatch) {
        resolvedCity = currentCityMatch[0];
      }
    }
    if (!resolvedCity) {
      // Fallback: match the LAST city in the string so parenthetical cities win
      const allMatches = [...from.matchAll(new RegExp(cityNames.source, "gi"))];
      if (allMatches.length > 0) {
        resolvedCity = allMatches[allMatches.length - 1][0];
      }
    }
    if (resolvedCity) {
      settingParts.push(`${resolvedCity} atmosphere`);
    }
  }

  const setting = settingParts.join(", ");

  return {
    appearance,
    keyTraits,
    outfit,
    props,
    setting,
    visualStyle,
  };
}

// ── Extract timezone from IDENTITY.md frontmatter ───────────────────────

function extractTimezone(identityContent: string): string {
  const match = identityContent.match(/^timezone:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "UTC";
}

/** Derive lighting/time context from character's local time */
function getTimeOfDayContext(timezone: string): string {
  let hour: number;
  try {
    const hourStr = new Date().toLocaleString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    hour = parseInt(hourStr, 10);
  } catch {
    hour = new Date().getHours();
  }

  if (hour >= 6 && hour < 9) return "early morning, soft golden sunrise light";
  if (hour >= 9 && hour < 12) return "morning, bright natural daylight";
  if (hour >= 12 && hour < 15) return "afternoon, warm sunlight";
  if (hour >= 15 && hour < 18) return "late afternoon, golden hour warm glow";
  if (hour >= 18 && hour < 21) return "evening, warm indoor lighting, sunset tones";
  if (hour >= 21 || hour < 1) return "nighttime, warm lamp lighting, dim cozy ambiance";
  return "late night, dim soft lighting, dark outside";
}

// ── fal.ai runners ──────────────────────────────────────────────────────

/** Synchronous fal.ai endpoint — fast for simple models like flux/dev */
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

/**
 * Queue-based fal.ai endpoint — required for reference-based models (PuLID,
 * InstantCharacter) that accept image URLs and need longer processing.
 */
async function falQueueRun(
  model: string,
  input: Record<string, unknown>,
  falKey: string
): Promise<Record<string, unknown>> {
  const submitResp = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text();
    throw new Error(`FAL submit failed (${submitResp.status}): ${errText.slice(0, 300)}`);
  }

  const { request_id: requestId } = (await submitResp.json()) as { request_id: string };

  const maxWait = 120_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const statusResp = await fetch(
      `https://queue.fal.run/${model}/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } }
    );
    const status = (await statusResp.json()) as { status: string };

    if (status.status === "COMPLETED") {
      const resultResp = await fetch(
        `https://queue.fal.run/${model}/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } }
      );
      return (await resultResp.json()) as Record<string, unknown>;
    }

    if (status.status === "FAILED") {
      throw new Error(`FAL job failed: ${JSON.stringify(status)}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`FAL job timed out after ${maxWait / 1000}s`);
}

/** Derive MIME type from file extension */
function mimeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

// ── Reference image preparation ─────────────────────────────────────────

/** Max dimension (longest side) for reference images sent to fal.ai */
const MAX_REF_DIMENSION = 1024;

/** JPEG quality for compressed reference images (92% preserves facial detail) */
const REF_JPEG_QUALITY = 92;

/** Max size in bytes for inline data URI — above this, upload to fal CDN */
const MAX_INLINE_SIZE = 500_000;

/**
 * Compress and resize a reference image to a JPEG buffer.
 *
 * Large reference images (e.g. Yuna's 1.9 MB RGBA PNG at 896x1195) produce
 * ~2.6 MB base64 data URIs that cause silent failures or timeouts with
 * fal.ai's queue API, making PuLID fail and fall through to flux/dev
 * (which has NO face consistency).
 *
 * This function:
 * 1. Reads the raw image bytes
 * 2. Downscales to max 1024px on the longest side
 * 3. Converts RGBA to RGB (JPEG doesn't support alpha)
 * 4. Encodes as JPEG at 85% quality (~100-200 KB typically)
 *
 * Uses sharp from @opencrush/cli (available in pnpm store).
 * Falls back to raw file if sharp is unavailable.
 */
async function compressReferenceImage(imagePath: string): Promise<{
  buffer: Buffer;
  sizeBytes: number;
  mime: string;
  method: "sharp" | "raw";
}> {
  // Try sharp (installed in @opencrush/cli, accessible via pnpm hoisting)
  try {
    const sharp = eval('require')('sharp');
    const imageBuffer = readFileSync(imagePath);

    const metadata = await sharp(imageBuffer).metadata();
    const origWidth = metadata.width ?? 0;
    const origHeight = metadata.height ?? 0;

    let pipeline = sharp(imageBuffer);

    // Downscale if either dimension exceeds MAX_REF_DIMENSION
    if (origWidth > MAX_REF_DIMENSION || origHeight > MAX_REF_DIMENSION) {
      pipeline = pipeline.resize({
        width: MAX_REF_DIMENSION,
        height: MAX_REF_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Flatten alpha channel (RGBA -> RGB) and encode as JPEG
    const jpegBuffer: Buffer = await pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: REF_JPEG_QUALITY })
      .toBuffer();

    console.log(
      `[generate-image] Reference resized with sharp: ` +
      `${origWidth}x${origHeight} -> max ${MAX_REF_DIMENSION}px, ` +
      `${imageBuffer.length} bytes -> ${jpegBuffer.length} bytes`
    );

    return {
      buffer: jpegBuffer,
      sizeBytes: jpegBuffer.length,
      mime: "image/jpeg",
      method: "sharp",
    };
  } catch (sharpErr) {
    console.warn(
      `[generate-image] sharp not available: ${sharpErr instanceof Error ? sharpErr.message : sharpErr}`
    );
  }

  // Fallback: read raw file as-is (no resize possible without sharp)
  const rawBuffer = readFileSync(imagePath);
  const mime = mimeFromPath(imagePath);

  console.warn(
    `[generate-image] Using raw reference image ` +
    `(${rawBuffer.length} bytes, ${mime}). Install sharp for better results.`
  );

  return {
    buffer: rawBuffer,
    sizeBytes: rawBuffer.length,
    mime,
    method: "raw",
  };
}

/**
 * Upload a reference image to fal.ai CDN storage and return the public URL.
 *
 * This avoids sending large base64 data URIs in the JSON body, which can
 * cause silent failures or 413 errors. The fal.ai models accept both
 * data URIs and https:// URLs for image inputs.
 *
 * Upload flow (mirrors @fal-ai/client storage):
 * 1. POST to https://rest.fal.ai/storage/upload/initiate for a presigned URL
 * 2. PUT the image bytes to the presigned URL
 * 3. Return the CDN file_url for use in model inputs
 */
async function uploadToFalStorage(
  imageBuffer: Buffer,
  contentType: string,
  falKey: string
): Promise<string> {
  const filename = `ref-${Date.now()}.jpg`;

  // Step 1: Initiate upload
  const initiateResp = await fetch(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content_type: contentType,
        file_name: filename,
      }),
    }
  );

  if (!initiateResp.ok) {
    const errText = await initiateResp.text();
    throw new Error(
      `FAL storage initiate failed (${initiateResp.status}): ${errText.slice(0, 300)}`
    );
  }

  const { upload_url: uploadUrl, file_url: fileUrl } =
    (await initiateResp.json()) as { upload_url: string; file_url: string };

  // Step 2: Upload the image bytes (convert Buffer to Uint8Array for fetch BodyInit)
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(imageBuffer),
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(
      `FAL storage upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`
    );
  }

  console.log(`[generate-image] Uploaded reference to fal CDN: ${fileUrl}`);
  return fileUrl;
}

/**
 * Prepare the reference image for fal.ai model input.
 *
 * Strategy:
 * 1. Check cache first — if this reference was already prepared, reuse the URL
 * 2. Resize/compress with sharp (if available)
 * 3. If compressed size <= 500 KB, use inline base64 data URI
 * 4. If still large, upload to fal.ai CDN storage and use the https URL
 */
const refUrlCache = new Map<string, { url: string; timestamp: number }>();
const REF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function prepareReferenceForFal(
  imagePath: string,
  falKey: string
): Promise<string> {
  // Evict stale entries on each access
  cleanExpiredEntries(refUrlCache, REF_CACHE_TTL);

  // Check cache — same reference image doesn't need re-upload
  const cached = refUrlCache.get(imagePath);
  if (cached && Date.now() - cached.timestamp < REF_CACHE_TTL) {
    console.log(`[generate-image] Using cached reference URL for ${imagePath}`);
    return cached.url;
  }

  const { buffer, sizeBytes, mime, method } =
    await compressReferenceImage(imagePath);

  // Small enough for inline data URI
  if (sizeBytes <= MAX_INLINE_SIZE) {
    const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;
    console.log(
      `[generate-image] Using inline data URI ` +
      `(${sizeBytes} bytes, method=${method})`
    );
    refUrlCache.set(imagePath, { url: dataUri, timestamp: Date.now() });
    return dataUri;
  }

  // Too large for inline — upload to fal CDN (only once, then cache)
  console.log(
    `[generate-image] Image ${sizeBytes} bytes > ${MAX_INLINE_SIZE} limit, ` +
    `uploading to fal CDN (will cache for 30min)`
  );
  const cdnUrl = await uploadToFalStorage(buffer, mime, falKey);
  refUrlCache.set(imagePath, { url: cdnUrl, timestamp: Date.now() });
  return cdnUrl;
}

// ── Extract image URL from fal.ai result ────────────────────────────────

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

// ── Build selfie prompt ─────────────────────────────────────────────────

type VisualStyle = "realistic" | "cgi" | "anime";

function detectVisualStyle(appearance: string): VisualStyle {
  const lower = appearance.toLowerCase();

  // CGI indicators: virtual idols, holographic elements, crystalline/neon features, 3D renders
  const cgiIndicators = [
    "cgi",
    "3d render",
    "unreal engine",
    "virtual idol",
    "holographic",
    "crystalline",
    "human render",
    "motion-captured",
    "digital entity",
    "nano-fiber",
  ];
  // Also match combined neon + wings/wing
  const hasCgiCombo =
    lower.includes("neon") &&
    (lower.includes("wing") || lower.includes("wings"));
  if (hasCgiCombo || cgiIndicators.some((kw) => lower.includes(kw))) {
    return "cgi";
  }

  const animeIndicators = [
    "anime",
    "vtuber",
    "heterochromia",
    "horns",
    "gradient hair",
  ];
  if (animeIndicators.some((kw) => lower.includes(kw))) {
    return "anime";
  }

  return "realistic";
}

/** Build time-of-day lighting emphasis for the prompt */
function buildTimeEmphasis(timeContext: string): string {
  const lower = timeContext.toLowerCase();
  if (lower.includes("nighttime") || lower.includes("late night")) {
    return `${timeContext}, nighttime scene, dark outside, indoor warm lighting, low ambient light`;
  }
  if (lower.includes("evening")) {
    return `${timeContext}, warm indoor glow, window showing dusk sky`;
  }
  if (lower.includes("sunrise") || lower.includes("early morning")) {
    return `${timeContext}, soft diffused sunrise light, gentle shadows`;
  }
  return timeContext;
}

/**
 * Derive a context-appropriate outfit from the character's IDENTITY.md appearance.
 * Parses "On stage" vs "Off stage" looks and picks based on the action/time context.
 */
function deriveOutfitFromAppearance(appearance: string, actionPrompt: string, timeContext?: string): string {
  const lowerAction = actionPrompt.toLowerCase();
  const lowerTime = (timeContext ?? '').toLowerCase();

  // Extract outfit blocks from appearance
  const onStageMatch = appearance.match(/on stage[^:]*:\s*([^.]+(?:\.[^.]+){0,2})/i);
  const offStageMatch = appearance.match(/off stage[^:]*:\s*([^.]+)/i);
  const casualMatch = appearance.match(/casual[^:]*:\s*([^.]+)/i);

  const stageOutfit = onStageMatch?.[1]?.trim() ?? '';
  const casualOutfit = offStageMatch?.[1]?.trim() ?? casualMatch?.[1]?.trim() ?? '';

  // Determine context
  const isPerformance = /stage|concert|perform|show|dance|practice room|choreo/i.test(lowerAction);
  const isSleeping = /bed|sleep|pajama|pillow|blanket|waking up/i.test(lowerAction);
  const isNight = /night|late night|dim|lamp/i.test(lowerTime);

  if (isPerformance && stageOutfit) {
    return `wearing ${stageOutfit}`;
  }
  if (isSleeping) {
    return 'wearing comfortable sleepwear, relaxed';
  }
  if (casualOutfit) {
    return `wearing ${casualOutfit}`;
  }
  // Fallback — let the model decide based on reference
  return '';
}

/**
 * Check whether the action prompt already specifies time-of-day or lighting.
 * If it does, skip the automatic timezone-based time context to avoid conflicts
 * (e.g., action says "morning light" but timezone says "nighttime").
 */
function actionPromptHasTimeOrLighting(actionPrompt: string): boolean {
  const lower = actionPrompt.toLowerCase();
  const timeKeywords = [
    "morning", "sunrise", "dawn", "early morning",
    "afternoon", "midday", "noon",
    "evening", "sunset", "dusk", "golden hour",
    "night", "nighttime", "late night", "midnight",
    "morning light", "natural light", "warm light", "dim light",
    "lamp light", "candlelight", "neon light", "moonlight",
    "sunlight", "daylight", "soft light", "bright light",
    "cozy lighting", "warm lighting", "indoor lighting",
    "dark outside", "dark room",
  ];
  return timeKeywords.some((kw) => lower.includes(kw));
}

/**
 * Extract ONLY scene/mood/pose context from the LLM's action prompt.
 * Everything about appearance (hair, clothes, accessories, props, drinks)
 * is DISCARDED — IDENTITY.md is the sole source of truth.
 *
 * Allowlist approach: keep words that describe WHERE, WHEN, HOW (mood/pose).
 * Anything that describes WHAT THE CHARACTER LOOKS LIKE is dropped.
 */
function extractSceneContext(actionPrompt: string): string {
  // Scene/location keywords to keep
  const scenePatterns = [
    // Locations
    /(?:at|in|on|inside|outside)\s+(?:the\s+)?(?:desk|bed|couch|sofa|kitchen|bathroom|balcony|rooftop|window|car|cafe|studio|gym|park|beach|street|restaurant|room|practice room|convenience store|mirror)[^,]*/gi,
    // Pose/position
    /(?:sitting|standing|lying|leaning|looking|posing|curled up|lounging|resting)[^,]*/gi,
    // Mood/expression
    /(?:sleepy|tired|happy|smiling|laughing|excited|bored|cozy|relaxed|focused|serious|playful|pouty|winking)[^,]*/gi,
    // Time/lighting (preserve if LLM specified)
    /(?:morning|afternoon|evening|night|golden hour|sunset|sunrise|dawn|midnight)\s*(?:light|lighting|sun|glow)?[^,]*/gi,
    /(?:soft|warm|dim|bright|neon|natural|lamp|cozy|cinematic)\s+(?:light|lighting|glow)[^,]*/gi,
    // Context objects (furniture, devices — NOT character props)
    /(?:laptop|phone|screen|monitor|pillow|blanket|curtain)\s*(?:open|nearby|visible|in background)?[^,]*/gi,
  ];

  const kept: string[] = [];
  for (const pattern of scenePatterns) {
    const matches = actionPrompt.match(pattern);
    if (matches) {
      kept.push(...matches.map((m) => m.trim().replace(/^,|,$/g, "").trim()));
    }
  }

  return kept
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .join(", ");
}

function buildSelfiePrompt(
  actionPrompt: string,
  appearance: string,
  style: string,
  hasReferenceImage: boolean,
  timeContext?: string,
  keyVisualTraits?: string,
  selfieContext?: CharacterSelfieContext
): string {
  const visualStyle = selfieContext?.visualStyle ?? detectVisualStyle(appearance);

  const stylePrefix: Record<string, string> = {
    casual:
      "candid selfie photo, upper body visible, medium shot framing",
    mirror:
      "full body mirror selfie, head to toe, standing pose, wide framing",
    "close-up":
      "close-up portrait, shallow depth of field, catch light in eyes",
    location:
      "selfie at scenic location, upper body visible, wide background visible",
  };

  const prefix = stylePrefix[style] ?? stylePrefix.casual;

  const shouldAddTimeContext =
    timeContext && !actionPromptHasTimeOrLighting(actionPrompt);
  const timeEmphasis = shouldAddTimeContext
    ? buildTimeEmphasis(timeContext)
    : "";

  const qualityTags: Record<VisualStyle, string> = {
    realistic:
      "shot on iPhone 15 Pro, natural skin texture, visible pores, cinematic color grading, film grain, raw unedited photo, not illustrated",
    cgi:
      "3D CGI render, Unreal Engine 5 quality, hyper-detailed, cinematic rim lighting, volumetric fog, game character quality, iridescent highlights, NOT a real photo",
    anime:
      "anime illustration style, high quality anime art, detailed anime character, vibrant colors, clean lines, NOT a real photo",
  };

  const traitsEmphasis = selfieContext?.keyTraits ?? keyVisualTraits ?? "";

  // Extract ONLY scene/mood/pose from LLM prompt — discard all appearance
  const sceneContext = extractSceneContext(actionPrompt);

  // Use enriched context from all MD files when available
  const outfitClause = selfieContext?.outfit
    ? selfieContext.outfit
    : deriveOutfitFromAppearance(appearance, actionPrompt, timeContext);
  const propsClause = selfieContext?.props ?? "";
  const settingClause = selfieContext?.setting ?? "";

  if (hasReferenceImage) {
    return [
      prefix,
      traitsEmphasis,
      sceneContext,
      outfitClause,
      propsClause,
      settingClause,
      timeEmphasis,
      "same person as reference photo, consistent face",
    ]
      .filter(Boolean)
      .join(", ");
  }

  // No reference image — full appearance + enriched context
  return [
    prefix,
    traitsEmphasis,
    sceneContext,
    outfitClause,
    propsClause,
    settingClause,
    timeEmphasis,
    appearance,
    qualityTags[visualStyle],
  ]
    .filter(Boolean)
    .join(", ");
}

// ── Image size per style ─────────────────────────────────────────────

/**
 * Return the fal.ai image_size preset appropriate for each selfie style.
 * - casual:   portrait_4_3 (768x1024) — head + upper body
 * - mirror:   portrait_16_9 (576x1024) — full body, head to toe
 * - close-up: portrait_4_3 (768x1024) — face close-up
 * - location: portrait_4_3 (768x1024) — scenic with character
 */
function imageSizeForStyle(style: string): string {
  const sizeMap: Record<string, string> = {
    casual: "portrait_4_3",
    mirror: "portrait_16_9",
    "close-up": "portrait_4_3",
    location: "portrait_4_3",
  };
  return sizeMap[style] ?? "portrait_4_3";
}

// ── Route handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;

  // Validate character
  if (name.includes("..") || name.includes("/")) {
    return NextResponse.json(
      { error: "Invalid character name" },
      { status: 400 }
    );
  }

  const charDir = join(CHARACTERS_DIR, name);
  const identityPath = join(charDir, "IDENTITY.md");
  if (!existsSync(charDir) || !existsSync(identityPath)) {
    return NextResponse.json(
      { error: `Character "${name}" not found` },
      { status: 404 }
    );
  }

  // Parse request body
  let body: { prompt?: string; style?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  if (prompt.length > 500) {
    return NextResponse.json(
      { error: "Prompt too long (max 500 chars)" },
      { status: 400 }
    );
  }

  const style = body.style ?? "casual";

  // Read FAL_KEY from .env (cached to avoid disk I/O on every request)
  let env: Record<string, string>;
  try {
    env = readEnvCached();
  } catch {
    return NextResponse.json(
      { error: "No .env found" },
      { status: 500 }
    );
  }
  const falKey = env.FAL_KEY;

  if (!falKey) {
    return NextResponse.json(
      { error: "FAL_KEY not configured in .env" },
      { status: 500 }
    );
  }

  // Read character appearance from IDENTITY.md (cached)
  const identityContent = readIdentityCached(identityPath);

  // Sanity check: verify the identity content belongs to the requested character.
  // The H1 heading in IDENTITY.md should match the character directory name.
  // This catches stale cache entries or path resolution issues.
  const identityNameMatch = identityContent.match(/^#\s+(.+)$/m);
  const identityName = identityNameMatch?.[1]?.trim().toLowerCase() ?? "";
  if (identityName && identityName !== name.toLowerCase()) {
    console.warn(
      `[generate-image] WARNING: Character mismatch! ` +
      `URL param="${name}" but IDENTITY.md H1="${identityNameMatch?.[1]?.trim()}". ` +
      `Clearing identity cache and re-reading.`
    );
    // Force re-read by evicting the potentially stale cache entry
    mdCache.delete(identityPath);
    // Re-read won't help if the file itself is wrong, but at least we log it
  }

  const appearance = extractAppearance(identityContent);

  // Check for reference image (needed before building prompt)
  const referenceExts = [".jpg", ".jpeg", ".png", ".webp"];
  let referenceImagePath: string | null = null;
  for (const ext of referenceExts) {
    const candidate = join(charDir, `reference${ext}`);
    if (existsSync(candidate)) {
      referenceImagePath = candidate;
      break;
    }
  }

  // Build enriched selfie context from ALL character MD files
  const timezone = extractTimezone(identityContent);
  const timeContext = getTimeOfDayContext(timezone);
  const sceneFromLLM = extractSceneContext(prompt);
  const selfieContext = buildCharacterSelfieContext(
    CHARACTERS_DIR,
    name,
    sceneFromLLM,
    timeContext
  );

  const fullPrompt = buildSelfiePrompt(
    prompt,
    appearance,
    style,
    !!referenceImagePath,
    timeContext,
    selfieContext.keyTraits,
    selfieContext
  );
  const imageSize = imageSizeForStyle(style);

  console.log(
    `[generate-image] character=${name} identity="${identityNameMatch?.[1]?.trim() ?? "?"}" ` +
    `style=${style} imageSize=${imageSize} hasRef=${!!referenceImagePath}`
  );
  console.log(`[generate-image] appearance: ${appearance.slice(0, 120)}`);
  console.log(`[generate-image] keyTraits: ${selfieContext.keyTraits.slice(0, 120)}`);
  console.log(`[generate-image] outfit: ${selfieContext.outfit}`);
  console.log(`[generate-image] props: ${selfieContext.props}`);
  console.log(`[generate-image] setting: ${selfieContext.setting}`);
  console.log(`[generate-image] actionPrompt: ${prompt.slice(0, 120)}`);
  console.log(`[generate-image] fullPrompt (${fullPrompt.length} chars): ${fullPrompt}`);

  try {
    let result: Record<string, unknown>;
    let modelUsed = "unknown";

    if (referenceImagePath) {
      // Prepare reference image: resize, compress, upload to fal CDN if needed
      const refImageUrl = await prepareReferenceForFal(referenceImagePath, falKey);

      console.log(
        `[generate-image] Reference prepared for ${name}: ` +
        `path=${referenceImagePath}, refUrl=${refImageUrl.slice(0, 80)}...`
      );

      // ── Model 1: PuLID (face consistency, ~$0.04/call with 28 steps) ──
      try {
        console.log(`[generate-image] Attempting PuLID (fal-ai/flux-pulid)...`);
        result = await falQueueRun(
          "fal-ai/flux-pulid",
          {
            prompt: fullPrompt,
            reference_image_url: refImageUrl,
            image_size: imageSize,
            guidance_scale: 3.0,
            num_inference_steps: 28,
            id_weight: 0.85,
          },
          falKey
        );

        const pulidUrl = extractImageUrl(result);
        if (pulidUrl) {
          modelUsed = "fal-ai/flux-pulid";
          console.log(`[generate-image] PuLID SUCCESS: got image URL`);
        } else {
          console.warn(
            `[generate-image] PuLID returned OK but no image URL in result: ` +
            `${JSON.stringify(result).slice(0, 300)}`
          );
          throw new Error("PuLID returned no image URL");
        }
      } catch (pulidErr) {
        const pulidErrMsg =
          pulidErr instanceof Error ? pulidErr.message : String(pulidErr);
        console.warn(`[generate-image] PuLID FAILED: ${pulidErrMsg}`);

        // ── Model 2: InstantCharacter (face consistency fallback) ──────
        try {
          console.log(`[generate-image] Attempting InstantCharacter...`);
          result = await falQueueRun(
            "fal-ai/instant-character",
            {
              prompt: fullPrompt,
              image_url: refImageUrl,
              image_size: imageSize,
              guidance_scale: 3.0,
              num_inference_steps: 28,
              scale: 1.0,
              num_images: 1,
              output_format: "jpeg",
            },
            falKey
          );
          const icUrl = extractImageUrl(result);
          if (icUrl) {
            modelUsed = "fal-ai/instant-character";
            console.log(`[generate-image] InstantCharacter SUCCESS`);
          } else {
            throw new Error("InstantCharacter returned no image URL");
          }
        } catch (icErr) {
          console.warn(`[generate-image] InstantCharacter FAILED: ${icErr instanceof Error ? icErr.message : icErr}`);
          // ── Model 3: flux/dev (no face consistency — last resort) ────
          console.log(`[generate-image] Falling back to flux/dev`);
          result = await falRun(
            "fal-ai/flux/dev",
            {
              prompt: fullPrompt,
              image_size: imageSize,
              num_images: 1,
              num_inference_steps: 28,
              enable_safety_checker: true,
            },
            falKey
          );
          modelUsed = "fal-ai/flux/dev";
        }
      }
    } else {
      // No reference image — use flux/dev directly
      console.log(`[generate-image] No reference image, using flux/dev directly`);
      result = await falRun(
        "fal-ai/flux/dev",
        {
          prompt: fullPrompt,
          image_size: imageSize,
          num_images: 1,
          num_inference_steps: 35,
          enable_safety_checker: true,
        },
        falKey
      );
      modelUsed = "fal-ai/flux/dev";
      console.log(`[generate-image] flux/dev SUCCESS (no reference)`);
    }

    console.log(`[generate-image] FINAL MODEL USED: ${modelUsed}`);

    const imageUrl = extractImageUrl(result);
    if (!imageUrl) {
      console.error(
        "[generate-image] No image URL in result:",
        JSON.stringify(result).slice(0, 500)
      );
      return NextResponse.json(
        { error: "Image generation returned no result" },
        { status: 502 }
      );
    }

    // Download the generated image (with 30s timeout)
    const controller = new AbortController();
    const downloadTimeout = setTimeout(() => controller.abort(), 30000);
    const imageResp = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(downloadTimeout);
    if (!imageResp.ok) {
      return NextResponse.json(
        { error: "Failed to download generated image" },
        { status: 502 }
      );
    }

    const imageBuffer = Buffer.from(await imageResp.arrayBuffer());

    // Save to characters/[name]/media/selfie-[timestamp].jpg
    const mediaDir = join(charDir, "media");
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `selfie-${timestamp}.jpg`;
    const filePath = join(mediaDir, filename);
    writeFileSync(filePath, imageBuffer);

    const url = `/api/media/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`;

    // Save image message to memory.db so it persists across refreshes.
    // Use the engine's shared DB connection to avoid SQLite BUSY errors from
    // concurrent writes (the engine may be writing at the same time).
    try {
      const engine = engineCache.get(name);
      if (engine) {
        const memory = engine.getMemory();
        const db = memory.getDatabase();

        // Delete assistant messages from this conversation turn that are NOT media markers.
        const windowMs = 180_000;
        db.prepare(`
          DELETE FROM messages
          WHERE role = 'assistant'
            AND (platform = 'dashboard' OR platform IS NULL)
            AND timestamp BETWEEN ? AND ?
            AND content NOT LIKE '[image:%'
            AND content NOT LIKE '[voice:%'
        `).run(timestamp - windowMs, timestamp + windowMs);

        // Include model attribution in the saved message for debugging
        memory.addMessage({
          role: 'assistant',
          content: `[image:${url}|model:${modelUsed}]`,
          timestamp,
          platform: 'dashboard',
        });

        // Store the generation prompt for audit trail and future deduplication.
        db.exec(`
          CREATE TABLE IF NOT EXISTS generation_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            type      TEXT NOT NULL,
            prompt    TEXT NOT NULL,
            model     TEXT NOT NULL,
            url       TEXT NOT NULL,
            style     TEXT,
            timestamp INTEGER NOT NULL
          )
        `);
        db.prepare(
          'INSERT INTO generation_log (type, prompt, model, url, style, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run('image', fullPrompt, modelUsed, url, style, timestamp);
      } else {
        console.warn('[generate-image] No engine in cache for', name, '— skipping DB write');
      }
    } catch (dbErr) {
      console.error('[generate-image] Failed to save to memory.db:', dbErr);
    }

    return NextResponse.json({ url, filename, model: modelUsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed";
    console.error(`[generate-image] Error: character=${name}`, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
