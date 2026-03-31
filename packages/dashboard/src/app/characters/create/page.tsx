"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Dices,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Heart,
  Users,
  GraduationCap,
  Pen,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type VisualStyleOption = "realistic" | "cgi" | "anime" | "custom";

interface CharacterForm {
  readonly name: string;
  readonly gender: string;
  readonly visualStyle: VisualStyleOption;
  readonly customStyleInput: string;
  readonly relationship: string;
  readonly customRelationship: string;
  readonly traits: readonly string[];
  readonly customTraitInput: string;
  readonly backstory: string;
}

interface GeneratedPreview {
  readonly identity: string;
  readonly soul: string;
  readonly user: string;
  readonly memory: string;
  readonly autonomy: string;
  readonly summary: string;
  readonly appearancePreview: string;
  readonly schedulePreview: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const INITIAL_FORM: CharacterForm = {
  name: "",
  gender: "female",
  visualStyle: "realistic",
  customStyleInput: "",
  relationship: "",
  customRelationship: "",
  traits: [],
  customTraitInput: "",
  backstory: "",
};

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
] as const;

const VISUAL_STYLE_OPTIONS = [
  { value: "realistic" as const, label: "Realistic", description: "Real-person-looking characters" },
  { value: "cgi" as const, label: "CGI / 3D", description: "Virtual idols, game characters" },
  { value: "anime" as const, label: "Anime / 2D", description: "Anime-style characters" },
  { value: "custom" as const, label: "Custom", description: "Describe your own style" },
] as const;

const RELATIONSHIP_OPTIONS = [
  {
    value: "friendship",
    label: "Friendship",
    description: "A close friend to talk to",
    icon: Users,
  },
  {
    value: "romantic",
    label: "Romantic",
    description: "A romantic companion",
    icon: Heart,
  },
  {
    value: "mentor",
    label: "Mentor",
    description: "A wise guide and advisor",
    icon: GraduationCap,
  },
  {
    value: "custom",
    label: "Custom",
    description: "Define your own dynamic",
    icon: Pen,
  },
] as const;

const TRAIT_OPTIONS = [
  "Affectionate",
  "Bold/Adventurous",
  "Compassionate",
  "Confident",
  "Deep Conversations",
  "Dramatic",
  "Expressive",
  "Flirty",
  "Innocent/Sweet",
  "Modest",
  "Opinionated",
  "Outgoing",
  "Philosophical",
  "Playful/Teasing",
  "Quiet/Reserved",
  "Romantic",
  "Sarcastic",
  "Shy",
  "Stubborn",
  "Thoughtful/Curious",
] as const;

const MIN_TRAITS = 3;
const MAX_TRAITS = 7;

const RANDOM_NAMES: Record<string, readonly string[]> = {
  female: ["Aria", "Zara", "Mika", "Lena", "Nova", "Sage", "Iris", "Vivi", "Cleo", "Jade", "Rin", "Mei", "Yuki", "Freya", "Lux"],
  male: ["Kai", "Leo", "Finn", "Axel", "Rune", "Jude", "Nash", "Rio", "Soren", "Atlas", "Zen", "Hugo", "Nix", "Cade", "Renji"],
  nonbinary: ["Quinn", "Rowan", "Avery", "River", "Sage", "Phoenix", "Wren", "Indigo", "Onyx", "Sol"],
};

const BACKSTORY_TEMPLATES = [
  "A street photographer who captures cities at 3 AM",
  "A former competitive gamer turned indie game developer",
  "A late-night radio DJ with a cult following",
  "A pastry chef who only bakes when it rains",
  "An underground music producer nobody knows by face",
  "A retired dancer who now teaches kids in a tiny studio",
  "A marine biologist obsessed with bioluminescent creatures",
  "A freelance tattoo artist who travels city to city",
  "A bookstore owner who writes anonymous love letters for strangers",
  "A storm chaser documenting extreme weather across the country",
  "A former hacker now working in cybersecurity by day and DJing by night",
  "A rooftop beekeeper in the middle of downtown",
  "A vintage clothing dealer who speaks four languages",
  "A sleep researcher who hardly ever sleeps",
  "A street magician saving up to open a magic theater",
  "A ceramics artist who only works between midnight and dawn",
  "A wildlife rescue volunteer with a fear of birds",
  "A competitive chess player who dropped out of med school",
  "A voice actor who can do over 50 distinct characters",
  "A florist who secretly writes poetry on the back of receipts",
] as const;

const RANDOM_TRAIT_COUNT_MIN = 4;
const RANDOM_TRAIT_COUNT_MAX = 5;

// ── Helpers ───────────────────────────────────────────────────────────────

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomN<T>(arr: readonly T[], n: number): readonly T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function detectLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language || "en";
  return lang.split("-")[0];
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/Los_Angeles";
  }
}

function buildDescription(form: CharacterForm): string {
  const relLabel =
    form.relationship === "custom"
      ? form.customRelationship.trim() || "custom companion"
      : form.relationship;

  const traitList =
    form.traits.length > 0
      ? `Key personality traits: ${form.traits.join(", ")}.`
      : "";

  const backstoryPart = form.backstory.trim()
    ? `Backstory: ${form.backstory.trim()}`
    : "";

  return [
    `A ${relLabel} companion.`,
    traitList,
    backstoryPart,
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveVisualStyle(form: CharacterForm): string {
  if (form.visualStyle === "custom") {
    return form.customStyleInput.trim() || "realistic";
  }
  return form.visualStyle;
}

// ── Section Header ────────────────────────────────────────────────────────

function SectionHeader({
  number,
  title,
  subtitle,
}: {
  readonly number: number;
  readonly title: string;
  readonly subtitle?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--primary))]/15 text-xs font-bold text-[hsl(var(--primary))]">
          {number}
        </span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {subtitle && (
        <p className="ml-10 mt-1 text-sm text-white/40">{subtitle}</p>
      )}
    </div>
  );
}

// ── Loading Overlay ───────────────────────────────────────────────────────

function CreatingOverlay() {
  const messages = [
    "Crafting personality...",
    "Writing backstory...",
    "Building daily rhythm...",
    "Generating character files...",
  ];
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-[hsl(var(--card))] p-10 shadow-2xl">
        <div className="relative">
          <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--primary))]" />
          <div className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--primary))]/20" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-white">
            Bringing your character to life
          </p>
          <p className="mt-2 text-sm text-white/50 transition-all duration-300">
            {messages[messageIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ───────────────────────────────────────────────────

export default function CreateCharacterPage() {
  const router = useRouter();

  // Form state
  const [form, setForm] = useState<CharacterForm>(INITIAL_FORM);
  const [backstoryOpen, setBackstoryOpen] = useState(false);

  // Process state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Random button animation
  const [diceSpinning, setDiceSpinning] = useState(false);

  // Auto-detected values
  const [language, setLanguage] = useState("en");
  const [timezone, setTimezone] = useState("America/Los_Angeles");

  useEffect(() => {
    setLanguage(detectLanguage());
    setTimezone(detectTimezone());
  }, []);

  // ── Form updaters (immutable) ──────────────────────────────────────────

  const updateField = useCallback(
    <K extends keyof CharacterForm>(key: K, value: CharacterForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    []
  );

  const toggleTrait = useCallback((trait: string) => {
    setForm((prev) => {
      const has = prev.traits.includes(trait);
      if (has) {
        return { ...prev, traits: prev.traits.filter((t) => t !== trait) };
      }
      if (prev.traits.length >= MAX_TRAITS) {
        return prev;
      }
      return { ...prev, traits: [...prev.traits, trait] };
    });
    setError(null);
  }, []);

  const addCustomTrait = useCallback(() => {
    const trait = form.customTraitInput.trim();
    if (!trait) return;
    if (form.traits.includes(trait)) {
      setForm((prev) => ({ ...prev, customTraitInput: "" }));
      return;
    }
    if (form.traits.length >= MAX_TRAITS) return;
    setForm((prev) => ({
      ...prev,
      traits: [...prev.traits, trait],
      customTraitInput: "",
    }));
  }, [form.customTraitInput, form.traits]);

  // ── Random fill ────────────────────────────────────────────────────────

  const handleRandom = useCallback(() => {
    const gender = pickRandom(GENDER_OPTIONS).value;
    const namesForGender = RANDOM_NAMES[gender] ?? RANDOM_NAMES["female"];
    const name = pickRandom(namesForGender);
    const relationship = pickRandom(
      RELATIONSHIP_OPTIONS.filter((o) => o.value !== "custom")
    ).value;
    const traitCount = randomIntBetween(RANDOM_TRAIT_COUNT_MIN, RANDOM_TRAIT_COUNT_MAX);
    const traits = pickRandomN(TRAIT_OPTIONS, traitCount);
    const backstory = pickRandom(BACKSTORY_TEMPLATES);

    const visualStyle = pickRandom(
      VISUAL_STYLE_OPTIONS.filter((o) => o.value !== "custom")
    ).value;

    setForm({
      name,
      gender,
      visualStyle,
      customStyleInput: "",
      relationship,
      customRelationship: "",
      traits,
      customTraitInput: "",
      backstory,
    });
    setBackstoryOpen(true);
    setError(null);

    // Trigger dice spin animation
    setDiceSpinning(true);
    setTimeout(() => setDiceSpinning(false), 600);
  }, []);

  // ── Validation ─────────────────────────────────────────────────────────

  const isValid =
    form.name.trim().length > 0 &&
    form.relationship.length > 0 &&
    (form.relationship !== "custom" ||
      form.customRelationship.trim().length > 0) &&
    form.traits.length >= MIN_TRAITS &&
    form.traits.length <= MAX_TRAITS;

  // ── Create flow ────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!isValid) {
      if (form.name.trim().length === 0) {
        setError("Please enter a name for your character.");
        return;
      }
      if (form.relationship.length === 0) {
        setError("Please select a relationship type.");
        return;
      }
      if (
        form.relationship === "custom" &&
        form.customRelationship.trim().length === 0
      ) {
        setError("Please describe your custom relationship type.");
        return;
      }
      if (form.traits.length < MIN_TRAITS) {
        setError(
          `Please select at least ${MIN_TRAITS} personality traits (${form.traits.length} selected).`
        );
        return;
      }
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // Step 1: Generate preview (LLM generates all 5 MD files)
      const description = buildDescription(form);
      const styleValue = resolveVisualStyle(form);

      const previewRes = await fetch("/api/character/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          gender: form.gender,
          description,
          personalityTags: [...form.traits],
          language,
          timezone,
          visualStyle: styleValue,
        }),
      });

      const previewData = await previewRes.json();

      if (!previewRes.ok) {
        setError(previewData.error || "Failed to generate character. Please try again.");
        setCreating(false);
        return;
      }

      const preview: GeneratedPreview = previewData;

      // Step 2: Create character with generated content
      const formData = new FormData();
      formData.append("mode", "wizard");
      formData.append("name", form.name.trim());
      formData.append("gender", form.gender);
      formData.append("visualStyle", styleValue);
      formData.append("language", language);
      formData.append("timezone", timezone);
      formData.append("identity", preview.identity);
      formData.append("soul", preview.soul);
      formData.append("user", preview.user);
      formData.append("memory", preview.memory);
      formData.append("autonomy", preview.autonomy);

      const createRes = await fetch("/api/character/create", {
        method: "POST",
        body: formData,
      });

      const createData = await createRes.json();

      if (!createRes.ok) {
        setError(
          createData.error || "Failed to create character. Please try again."
        );
        setCreating(false);
        return;
      }

      // Redirect to the new character's chat page
      router.push(`/characters/${createData.slug}`);
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
      setCreating(false);
    }
  }, [isValid, form, language, timezone, router]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {creating && <CreatingOverlay />}

      <div className="mx-auto max-w-2xl px-6 py-8 lg:px-10 lg:py-12">
        {/* Header */}
        <div className="mb-10">
          <button
            type="button"
            onClick={() => router.push("/characters")}
            className="mb-6 flex items-center gap-2 text-sm text-white/40 transition-colors hover:text-white/70"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white">
                Create Your{" "}
                <span className="text-gradient-crush">Companion</span>
              </h1>
              <p className="mt-2 text-sm text-white/50">
                Tell us a little about who they are. We will handle the rest.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRandom}
              className="mt-1 flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/70 transition-all hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--primary))]/10 hover:text-[hsl(var(--primary))] active:scale-95"
            >
              <Dices
                className={`h-5 w-5 transition-transform ${diceSpinning ? "animate-[dice-spin_0.6s_ease-out]" : ""}`}
              />
              Random
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
            <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 1: Basics — Gender + Name */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="glass rounded-2xl p-6 mb-6">
          <SectionHeader number={1} title="The Basics" />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
            {/* Gender selector */}
            <div className="sm:w-auto">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">
                Gender
              </label>
              <div className="flex gap-1.5">
                {GENDER_OPTIONS.map((opt) => {
                  const isSelected = form.gender === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField("gender", opt.value)}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        isSelected
                          ? "border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] shadow-sm shadow-[hsl(var(--primary))]/10"
                          : "border-white/8 bg-white/[0.03] text-white/50 hover:border-white/15 hover:bg-white/[0.06] hover:text-white/70"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Name input */}
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">
                Name <span className="text-[hsl(var(--primary))]">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Luna, Yuna, Sable..."
                className="flex h-[42px] w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-white/25 transition-all focus:border-[hsl(var(--primary))]/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
          </div>

          {/* Visual Style selector */}
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">
              Visual Style
            </label>
            <div className="flex flex-wrap gap-1.5">
              {VISUAL_STYLE_OPTIONS.map((opt) => {
                const isSelected = form.visualStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateField("visualStyle", opt.value)}
                    className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                      isSelected
                        ? "border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] shadow-sm shadow-[hsl(var(--primary))]/10"
                        : "border-white/8 bg-white/[0.03] text-white/50 hover:border-white/15 hover:bg-white/[0.06] hover:text-white/70"
                    }`}
                    title={opt.description}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {form.visualStyle === "custom" && (
              <input
                type="text"
                value={form.customStyleInput}
                onChange={(e) => updateField("customStyleInput", e.target.value)}
                placeholder="Describe your visual style (e.g. watercolor, pixel art, oil painting...)"
                className="mt-2 flex h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-white/25 transition-all focus:border-[hsl(var(--primary))]/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30"
              />
            )}
            <p className="mt-1.5 text-xs text-white/30">
              Affects the generated reference image style
            </p>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 2: Relationship */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="glass rounded-2xl p-6 mb-6">
          <SectionHeader
            number={2}
            title="Relationship"
            subtitle="What kind of companion are they?"
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RELATIONSHIP_OPTIONS.map((opt) => {
              const isSelected = form.relationship === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateField("relationship", opt.value)}
                  className={`group relative flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center transition-all ${
                    isSelected
                      ? "border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/10 shadow-md shadow-[hsl(var(--primary))]/10"
                      : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]"
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                      isSelected
                        ? "bg-[hsl(var(--primary))]/20 text-[hsl(var(--primary))]"
                        : "bg-white/5 text-white/40 group-hover:bg-white/10 group-hover:text-white/60"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p
                      className={`text-sm font-semibold transition-colors ${
                        isSelected ? "text-white" : "text-white/70"
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] leading-tight transition-colors ${
                        isSelected ? "text-white/50" : "text-white/30"
                      }`}
                    >
                      {opt.description}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] shadow-lg">
                      <svg
                        className="h-3 w-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom relationship input */}
          {form.relationship === "custom" && (
            <div className="mt-4">
              <input
                type="text"
                value={form.customRelationship}
                onChange={(e) =>
                  updateField("customRelationship", e.target.value)
                }
                placeholder="Describe the relationship dynamic..."
                className="flex h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-white/25 transition-all focus:border-[hsl(var(--primary))]/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30"
              />
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 3: Key Traits */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="glass rounded-2xl p-6 mb-6">
          <SectionHeader
            number={3}
            title="Key Traits"
            subtitle={`Pick ${MIN_TRAITS}-${MAX_TRAITS} personality traits (${form.traits.length} selected)`}
          />

          {/* Trait pills grid */}
          <div className="flex flex-wrap gap-2">
            {TRAIT_OPTIONS.map((trait) => {
              const isSelected = form.traits.includes(trait);
              const isMaxed =
                !isSelected && form.traits.length >= MAX_TRAITS;

              return (
                <button
                  key={trait}
                  type="button"
                  onClick={() => toggleTrait(trait)}
                  disabled={isMaxed}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
                    isSelected
                      ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/40 shadow-sm shadow-[hsl(var(--primary))]/10"
                      : isMaxed
                        ? "bg-white/[0.02] text-white/20 cursor-not-allowed"
                        : "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70"
                  }`}
                >
                  {isSelected && (
                    <span className="mr-1 inline-block">
                      <svg
                        className="inline h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </span>
                  )}
                  {trait}
                </button>
              );
            })}

            {/* Custom traits already added */}
            {form.traits
              .filter(
                (t) =>
                  !TRAIT_OPTIONS.includes(
                    t as (typeof TRAIT_OPTIONS)[number]
                  )
              )
              .map((trait) => (
                <button
                  key={trait}
                  type="button"
                  onClick={() => toggleTrait(trait)}
                  className="flex items-center gap-1 rounded-full bg-purple-500/15 px-3.5 py-1.5 text-sm font-medium text-purple-400 ring-1 ring-purple-500/30 transition-all hover:bg-purple-500/20"
                >
                  {trait}
                  <X className="h-3 w-3" />
                </button>
              ))}
          </div>

          {/* Add custom trait */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={form.customTraitInput}
              onChange={(e) => updateField("customTraitInput", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomTrait();
                }
              }}
              placeholder="Add your own..."
              disabled={form.traits.length >= MAX_TRAITS}
              className="flex h-9 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/25 transition-all focus:border-[hsl(var(--primary))]/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={addCustomTrait}
              disabled={
                !form.customTraitInput.trim() ||
                form.traits.length >= MAX_TRAITS
              }
              className="rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>

          {/* Traits count indicator */}
          {form.traits.length > 0 && form.traits.length < MIN_TRAITS && (
            <p className="mt-3 text-xs text-amber-400/70">
              Select {MIN_TRAITS - form.traits.length} more trait
              {MIN_TRAITS - form.traits.length > 1 ? "s" : ""} to continue
            </p>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Section 4: Backstory (optional, collapsible) */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="glass rounded-2xl p-6 mb-10">
          <button
            type="button"
            onClick={() => setBackstoryOpen(!backstoryOpen)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-white/40">
                4
              </span>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-white">Backstory</h2>
                <p className="text-xs text-white/40">
                  Optional — give your character a history
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {form.backstory.trim() && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  Added
                </span>
              )}
              {backstoryOpen ? (
                <ChevronUp className="h-5 w-5 text-white/30" />
              ) : (
                <ChevronDown className="h-5 w-5 text-white/30" />
              )}
            </div>
          </button>

          {backstoryOpen && (
            <div className="mt-4">
              <textarea
                value={form.backstory}
                onChange={(e) => updateField("backstory", e.target.value)}
                placeholder="e.g. Grew up in a small coastal town, moved to the city to pursue music. Has a mysterious past they don't talk about much..."
                rows={4}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-white placeholder:text-white/25 transition-all focus:border-[hsl(var(--primary))]/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30"
              />
              <p className="mt-1.5 text-xs text-white/30">
                The AI will weave this into the character&apos;s identity and
                memories.
              </p>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Create Button */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="pb-10">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !isValid}
            className={`flex w-full items-center justify-center gap-3 rounded-xl py-4 text-base font-bold transition-all ${
              isValid && !creating
                ? "bg-[hsl(var(--primary))] text-white shadow-xl crush-glow-strong hover:brightness-110 active:scale-[0.98]"
                : "bg-white/5 text-white/30 cursor-not-allowed"
            }`}
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Creating Character...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Create Character
              </>
            )}
          </button>

          {!isValid && form.name.trim().length > 0 && (
            <p className="mt-3 text-center text-xs text-white/30">
              {form.relationship.length === 0
                ? "Select a relationship type to continue"
                : form.traits.length < MIN_TRAITS
                  ? `Select ${MIN_TRAITS - form.traits.length} more trait${MIN_TRAITS - form.traits.length > 1 ? "s" : ""}`
                  : "Complete all required fields to continue"}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
