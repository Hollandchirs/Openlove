"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MapPin,
  Briefcase,
  Globe,
  Heart,
  Ban,
  Drama,
  Sparkles,
  Quote,
  Users,
  BookOpen,
  Clock,
  ChevronLeft,
  Star,
  FileEdit,
  MessageCircle,
  Image as ImageIcon,
  BarChart3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MdEditor } from "@/components/md-editor";
import MessageViewer from "@/components/message-viewer";
import { MediaGallery } from "@/components/media-gallery";
import { CapabilityCards } from "@/components/capability-cards";
import { RelationshipProgression } from "@/components/relationship-progression";
import MetricsDashboard from "@/components/metrics-dashboard";
import { getStageDisplay } from "@/lib/stage-display";

// ── Types ──────────────────────────────────────────────────────────────

interface RelationshipData {
  closeness: number;
  trust: number;
  familiarity: number;
  totalMessages: number;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  lastInteraction: number;
  stage: string;
}

interface CharacterDetail {
  name: string;
  age: string;
  location: string;
  job: string;
  hobbies: string[];
  referenceImageRelative: string | null;
  hasMemory: boolean;
  hasCard: boolean;
  relationshipStage: string | null;
  messageCount: number;
  gender: string;
  language: string;
  identity: {
    appearance: string;
    background: string;
    languages: string;
    fullJob: string;
    timezone: string;
  };
  soul: {
    voiceAndVibe: string;
    loves: string[];
    dislikes: string[];
    emotionalPatterns: string[];
    thingsSheDoes: string[];
    speechPatterns: string[];
  };
  user: {
    howWeMet: string;
    whatSheCalls: string;
    dynamic: string;
    thingsKnown: string[];
    sharedHistory: string[];
    feelings: string;
  };
  vibeColor: string;
  relationship: RelationshipData | null;
}


// ── Primitives ─────────────────────────────────────────────────────────

function GlassCard({
  children,
  className = "",
  vibeColor,
}: {
  children: React.ReactNode;
  className?: string;
  vibeColor?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl glass-strong card-shine ${className}`}
      style={
        vibeColor
          ? ({
              "--vibe-color-alpha": `${vibeColor}33`,
              "--vibe-color-alpha-deep": `${vibeColor}0d`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  vibeColor,
}: {
  icon: React.ElementType;
  title: string;
  vibeColor: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div
        className="flex items-center justify-center w-9 h-9 rounded-xl"
        style={{ backgroundColor: `${vibeColor}18` }}
      >
        <Icon className="w-4 h-4" style={{ color: vibeColor }} />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
    </div>
  );
}

function BulletList({
  items,
  vibeColor,
}: {
  items: string[];
  vibeColor: string;
}) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-3 text-sm text-foreground/80"
        >
          <span
            className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: vibeColor }}
          />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function EmotionalPatternCard({
  pattern,
  vibeColor,
  index,
}: {
  pattern: string;
  vibeColor: string;
  index: number;
}) {
  // Try to split "Label: description" or "Label — description"
  const splitMatch = pattern.match(
    /^([A-Z][^:—\n]{0,25})\s*[:—]\s*([\s\S]+)/i
  );
  const label = splitMatch?.[1]?.trim();
  const description = splitMatch?.[2]?.trim() ?? pattern;

  return (
    <div
      className="p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {label && (
        <span
          className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
          style={{ color: vibeColor }}
        >
          {label}
        </span>
      )}
      <p className="text-sm text-foreground/70 leading-relaxed">{description}</p>
    </div>
  );
}

function SpeechBubble({
  pattern,
  vibeColor,
}: {
  pattern: string;
  vibeColor: string;
}) {
  // Extract quoted phrase and meaning, e.g. `"phrase" — meaning`
  const quoteMatch = pattern.match(
    /^[""]([^""]+)[""]\s*[—\-:]+\s*([\s\S]*)/
  );
  const phrase = quoteMatch?.[1] ?? pattern.split("—")[0]?.trim() ?? pattern;
  const meaning =
    quoteMatch?.[2]?.trim() ??
    pattern
      .split("—")
      .slice(1)
      .join("—")
      .trim();

  return (
    <div className="flex items-start gap-3 group">
      <Quote
        className="w-4 h-4 mt-0.5 shrink-0 opacity-40 group-hover:opacity-70 transition-opacity"
        style={{ color: vibeColor }}
      />
      <div>
        <span className="text-sm font-medium text-foreground/90">{phrase}</span>
        {meaning && (
          <p className="text-xs text-foreground/50 mt-0.5 leading-relaxed">
            {meaning}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Hero Section ───────────────────────────────────────────────────────

function HeroSection({ character }: { character: CharacterDetail }) {
  const { vibeColor } = character;

  return (
    <div className="relative w-full pb-6">
      {/* Top blurred banner — standalone decorative section */}
      <div className="relative w-full h-48 overflow-hidden">
        {character.referenceImageRelative ? (
          <>
            <img
              src={character.referenceImageRelative}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${vibeColor}30, transparent 50%, ${vibeColor}20)` }}
          />
        )}
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${vibeColor}, transparent)` }} />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 flex items-center gap-8">
        {/* Portrait */}
        {character.referenceImageRelative && (
          <div className="relative shrink-0 hidden md:block">
            <div
              className="w-36 h-36 rounded-2xl overflow-hidden shadow-2xl"
              style={{
                boxShadow: `0 15px 40px ${vibeColor}30, 0 0 0 2px ${vibeColor}40`,
              }}
            >
              <img
                src={character.referenceImageRelative}
                alt={character.name}
                className="w-full h-full object-cover"
              />
            </div>
            {/* Decorative glow ring */}
            <div
              className="absolute -inset-1 rounded-2xl opacity-25 pointer-events-none"
              style={{
                border: `2px solid ${vibeColor}`,
                filter: "blur(2px)",
              }}
            />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
            <span
              className="gradient-text"
              style={{
                backgroundImage: `linear-gradient(135deg, ${vibeColor}, white, ${vibeColor}bb)`,
              }}
            >
              {character.name}
            </span>
          </h1>

          {/* Stat badges */}
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            {character.age && (
              <Badge variant="ghost" className="text-xs gap-1.5">
                <Star className="w-3 h-3" style={{ color: vibeColor }} />
                Age {character.age}
              </Badge>
            )}
            {character.location && (
              <Badge variant="ghost" className="text-xs gap-1.5">
                <MapPin className="w-3 h-3" style={{ color: vibeColor }} />
                {character.location}
              </Badge>
            )}
            {character.identity.timezone && (
              <Badge variant="ghost" className="text-xs gap-1.5">
                <Clock className="w-3 h-3" style={{ color: vibeColor }} />
                {character.identity.timezone
                  .split("/")
                  .pop()
                  ?.replace("_", " ")}
              </Badge>
            )}
            {character.relationshipStage && (
              <Badge
                className="text-xs"
                style={{
                  backgroundColor: `${vibeColor}20`,
                  color: vibeColor,
                  borderColor: `${vibeColor}40`,
                }}
              >
                {getStageDisplay(character.relationshipStage).label}
              </Badge>
            )}
          </div>

          {/* Job line */}
          <p className="text-sm text-foreground/60 max-w-xl leading-relaxed">
            <Briefcase
              className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5"
              style={{ color: vibeColor }}
            />
            {character.identity.fullJob || character.job}
          </p>
        </div>

        {/* Message count pill */}
        {character.messageCount > 0 && (
          <div className="hidden lg:flex flex-col items-center shrink-0">
            <div
              className="glass-strong rounded-2xl px-5 py-3 text-center vibe-glow"
              style={
                {
                  "--vibe-color-alpha": `${vibeColor}25`,
                  "--vibe-color-alpha-deep": `${vibeColor}08`,
                } as React.CSSProperties
              }
            >
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: vibeColor }}
              >
                {character.messageCount.toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-foreground/40 mt-0.5">
                messages
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Identity Card ──────────────────────────────────────────────────────

function IdentityCard({ character }: { character: CharacterDetail }) {
  const { vibeColor } = character;

  return (
    <GlassCard vibeColor={vibeColor} className="p-6">
      <SectionHeader icon={BookOpen} title="Identity" vibeColor={vibeColor} />

      {/* Appearance */}
      {character.identity.appearance && (
        <div className="mb-6">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2.5">
            Appearance
          </h4>
          <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
            {character.identity.appearance}
          </p>
        </div>
      )}

      <Separator className="my-5 bg-white/5" />

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {character.identity.languages && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground/40">
              <Globe className="w-3 h-3" style={{ color: vibeColor }} />
              Languages
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              {character.identity.languages}
            </p>
          </div>
        )}

        {character.hobbies.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground/40">
              <Sparkles className="w-3 h-3" style={{ color: vibeColor }} />
              Hobbies
            </div>
            <div className="flex flex-wrap gap-1.5">
              {character.hobbies.map((hobby, i) => (
                <Badge key={i} variant="ghost" className="text-xs">
                  {hobby}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Background */}
      {character.identity.background && (
        <>
          <Separator className="my-5 bg-white/5" />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2.5">
              Background
            </h4>
            <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
              {character.identity.background}
            </p>
          </div>
        </>
      )}
    </GlassCard>
  );
}

// ── Personality Panel ──────────────────────────────────────────────────

function PersonalityPanel({ character }: { character: CharacterDetail }) {
  const { soul, vibeColor } = character;

  return (
    <GlassCard vibeColor={vibeColor} className="p-6">
      <SectionHeader icon={Drama} title="Personality" vibeColor={vibeColor} />

      <Tabs defaultValue="vibe">
        <TabsList className="w-full bg-white/5 mb-6">
          <TabsTrigger value="vibe" className="flex-1 text-xs">
            Voice & Vibe
          </TabsTrigger>
          <TabsTrigger value="loves" className="flex-1 text-xs">
            Loves
          </TabsTrigger>
          <TabsTrigger value="dislikes" className="flex-1 text-xs">
            Dislikes
          </TabsTrigger>
          <TabsTrigger value="emotions" className="flex-1 text-xs">
            Emotions
          </TabsTrigger>
          <TabsTrigger value="speech" className="flex-1 text-xs">
            Speech
          </TabsTrigger>
        </TabsList>

        {/* Voice & Vibe */}
        <TabsContent value="vibe">
          {soul.voiceAndVibe && (
            <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
              {soul.voiceAndVibe}
            </p>
          )}
          {soul.thingsSheDoes.length > 0 && (
            <>
              <Separator className="my-5 bg-white/5" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-3">
                Signature Habits
              </h4>
              <BulletList items={soul.thingsSheDoes} vibeColor={vibeColor} />
            </>
          )}
        </TabsContent>

        {/* Loves */}
        <TabsContent value="loves">
          <div className="space-y-2">
            {soul.loves.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <Heart
                  className="w-3.5 h-3.5 mt-0.5 shrink-0"
                  style={{ color: vibeColor }}
                  fill={vibeColor}
                />
                <span className="text-sm text-foreground/75 leading-relaxed">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Dislikes */}
        <TabsContent value="dislikes">
          <div className="space-y-2">
            {soul.dislikes.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400/60" />
                <span className="text-sm text-foreground/75 leading-relaxed">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Emotional Patterns */}
        <TabsContent value="emotions">
          <div className="grid gap-3">
            {soul.emotionalPatterns.map((pattern, i) => (
              <EmotionalPatternCard
                key={i}
                pattern={pattern}
                vibeColor={vibeColor}
                index={i}
              />
            ))}
          </div>
        </TabsContent>

        {/* Speech Patterns */}
        <TabsContent value="speech">
          <div className="space-y-4">
            {soul.speechPatterns.map((pattern, i) => (
              <SpeechBubble key={i} pattern={pattern} vibeColor={vibeColor} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </GlassCard>
  );
}

// ── User Relationship ──────────────────────────────────────────────────

function UserRelationship({ character }: { character: CharacterDetail }) {
  const { user: rel, vibeColor } = character;
  const hasContent =
    rel.howWeMet ||
    rel.dynamic ||
    rel.whatSheCalls ||
    rel.thingsKnown.length > 0 ||
    rel.sharedHistory.length > 0 ||
    rel.feelings;

  if (!hasContent) return null;

  return (
    <GlassCard vibeColor={vibeColor} className="p-6">
      <SectionHeader
        icon={Users}
        title="Your Relationship"
        vibeColor={vibeColor}
      />

      <Tabs defaultValue="story">
        <TabsList className="w-full bg-white/5 mb-6">
          <TabsTrigger value="story" className="flex-1 text-xs">
            Our Story
          </TabsTrigger>
          {(rel.thingsKnown.length > 0 || rel.sharedHistory.length > 0) && (
            <TabsTrigger value="memories" className="flex-1 text-xs">
              Memories
            </TabsTrigger>
          )}
          {rel.feelings && (
            <TabsTrigger value="feelings" className="flex-1 text-xs">
              Her Feelings
            </TabsTrigger>
          )}
        </TabsList>

        {/* Our Story */}
        <TabsContent value="story">
          {rel.howWeMet && (
            <div className="mb-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2.5">
                How You Met
              </h4>
              <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                {rel.howWeMet}
              </p>
            </div>
          )}

          {rel.whatSheCalls && (
            <>
              <Separator className="my-5 bg-white/5" />
              <div className="mb-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2.5">
                  What She Calls You
                </h4>
                <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                  {rel.whatSheCalls}
                </p>
              </div>
            </>
          )}

          {rel.dynamic && (
            <>
              <Separator className="my-5 bg-white/5" />
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2.5">
                  Your Dynamic
                </h4>
                <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                  {rel.dynamic}
                </p>
              </div>
            </>
          )}
        </TabsContent>

        {/* Memories */}
        {(rel.thingsKnown.length > 0 || rel.sharedHistory.length > 0) && (
          <TabsContent value="memories">
            {rel.thingsKnown.length > 0 && (
              <div className="mb-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-3">
                  Things She Knows About You
                </h4>
                <BulletList items={rel.thingsKnown} vibeColor={vibeColor} />
              </div>
            )}

            {rel.sharedHistory.length > 0 && (
              <>
                <Separator className="my-5 bg-white/5" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-3">
                  Shared Memories
                </h4>
                <div className="space-y-4">
                  {rel.sharedHistory.map((memory, i) => (
                    <div key={i} className="relative pl-6">
                      {/* Timeline dot */}
                      <div
                        className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full"
                        style={{
                          backgroundColor: vibeColor,
                          boxShadow: `0 0 8px ${vibeColor}40`,
                        }}
                      />
                      {/* Timeline line */}
                      {i < rel.sharedHistory.length - 1 && (
                        <div
                          className="absolute left-[4px] top-4 bottom-0 w-0.5"
                          style={{ backgroundColor: `${vibeColor}20` }}
                        />
                      )}
                      <p className="text-sm text-foreground/70 leading-relaxed pb-1">
                        {memory}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* Her Feelings */}
        {rel.feelings && (
          <TabsContent value="feelings">
            <div
              className="relative p-5 rounded-xl border border-white/5 overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${vibeColor}08, transparent, ${vibeColor}05)`,
              }}
            >
              <Heart
                className="absolute top-4 right-4 w-16 h-16 opacity-[0.04]"
                style={{ color: vibeColor }}
              />
              <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line relative z-10">
                {rel.feelings}
              </p>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </GlassCard>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function CharacterProfilePage() {
  const params = useParams();
  const name = params.name as string;
  const [character, setCharacter] = useState<CharacterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"profile" | "messages" | "media" | "metrics" | "files">("profile");
  const [relationshipHistory, setRelationshipHistory] = useState<Array<{
    id: number;
    timestamp: number;
    closeness: number;
    trust: number;
    familiarity: number;
    closenessDelta: number;
    trustDelta: number;
    familiarityDelta: number;
    triggerText: string | null;
    stage: string;
  }>>([]);

  useEffect(() => {
    fetch(`/api/character/${name}`)
      .then((res) => {
        if (!res.ok) throw new Error("Character not found");
        return res.json();
      })
      .then(setCharacter)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Fetch relationship history for the progression component
    fetch(`/api/character/${name}/stats`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.relationshipHistory) {
          setRelationshipHistory(data.relationshipHistory);
        }
      })
      .catch(() => {/* ignore */});
  }, [name]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          <p className="text-sm text-foreground/40 tracking-wide">
            Loading character...
          </p>
        </div>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-2xl font-bold">Character Not Found</h2>
          <p className="text-foreground/50">
            Could not find a character named &ldquo;{name}&rdquo;
          </p>
          <a
            href="/"
            className="inline-block mt-2 text-sm underline text-foreground/60 hover:text-foreground transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Floating back button */}
      <div className="fixed top-4 left-4 z-50">
        <a
          href="/"
          className="flex items-center gap-1.5 glass-strong rounded-full px-4 py-2 text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Dashboard
        </a>
      </div>

      {/* Hero */}
      <HeroSection character={character} />

      {/* View toggle */}
      <div className="max-w-6xl mx-auto px-6 mt-1 relative z-20">
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1 w-fit mb-6">
          <button
            onClick={() => setView("profile")}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all
              ${view === "profile"
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/70"
              }
            `}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Profile
          </button>
          <button
            onClick={() => setView("messages")}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all
              ${view === "messages"
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/70"
              }
            `}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Messages
          </button>
          <button
            onClick={() => setView("media")}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all
              ${view === "media"
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/70"
              }
            `}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Media
          </button>
          <button
            onClick={() => setView("metrics")}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all
              ${view === "metrics"
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/70"
              }
            `}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Metrics
          </button>
          <button
            onClick={() => setView("files")}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all
              ${view === "files"
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/70"
              }
            `}
          >
            <FileEdit className="w-3.5 h-3.5" />
            Edit Files
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 relative z-20 pb-20">
        {view === "profile" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column */}
            <div className="space-y-6">
              <IdentityCard character={character} />

              {/* Relationship Progression */}
              {character.relationship && (
                <GlassCard vibeColor={character.vibeColor} className="p-6">
                  <SectionHeader
                    icon={Heart}
                    title="Relationship"
                    vibeColor={character.vibeColor}
                  />
                  <RelationshipProgression
                    relationship={character.relationship}
                    history={relationshipHistory}
                    vibeColor={character.vibeColor}
                    characterName={character.name}
                  />
                </GlassCard>
              )}

              <UserRelationship character={character} />
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <PersonalityPanel character={character} />
            </div>
          </div>
        ) : view === "metrics" ? (
          <MetricsDashboard slug={name} />
        ) : view === "messages" ? (
          <MessageViewer
            characterName={character.name}
            characterSlug={name}
            vibeColor={character.vibeColor}
          />
        ) : view === "media" ? (
          <div className="space-y-6">
            {/* Capabilities */}
            <GlassCard vibeColor={character.vibeColor} className="p-6">
              <SectionHeader
                icon={Sparkles}
                title="Capabilities"
                vibeColor={character.vibeColor}
              />
              <CapabilityCards
                characterName={name}
                vibeColor={character.vibeColor}
              />
            </GlassCard>

            {/* Gallery */}
            <GlassCard vibeColor={character.vibeColor} className="p-6">
              <SectionHeader
                icon={ImageIcon}
                title="Media Gallery"
                vibeColor={character.vibeColor}
              />
              <MediaGallery
                characterName={name}
                vibeColor={character.vibeColor}
              />
            </GlassCard>
          </div>
        ) : (
          <GlassCard vibeColor={character.vibeColor} className="p-6">
            <SectionHeader
              icon={FileEdit}
              title="Character Files"
              vibeColor={character.vibeColor}
            />
            <p className="text-sm text-foreground/50 mb-6">
              Edit personality, identity, memory, and relationship files directly.
              Changes save to disk.
            </p>
            <MdEditor
              characterName={name}
              vibeColor={character.vibeColor}
            />
          </GlassCard>
        )}
      </div>
    </div>
  );
}
