import { getCharacters, type CharacterSummary } from "@/lib/data";
import { getStageDisplay } from "@/lib/memory-data";
import Link from "next/link";
import { Heart, MessageCircle, Sparkles, Terminal, Plus } from "lucide-react";

function CharacterCard({ character }: { character: CharacterSummary }) {
  const stageDisplay = character.relationshipStage
    ? getStageDisplay(character.relationshipStage)
    : null;
  const meta = [character.age, character.location].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/characters/${character.slug}`}
      className="group relative block aspect-[3/4] overflow-hidden rounded-2xl border border-white/5 bg-card transition-all duration-300 hover:scale-[1.03] hover:border-pink-500/30 hover:crush-glow"
    >
      {/* Background image */}
      {character.referenceImageRelative ? (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={character.referenceImageRelative}
            alt={character.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900">
          <div className="flex h-full items-center justify-center">
            <span className="text-6xl font-bold text-white/10">
              {character.name[0]}
            </span>
          </div>
        </div>
      )}

      {/* Gradient overlay — darker at bottom for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

      {/* Top badges */}
      <div className="absolute left-3 right-3 top-3 flex items-start justify-between">
        {stageDisplay && (
          <span
            className={`${stageDisplay.badgeColor} inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur-sm`}
          >
            <Heart className="h-3 w-3" />
            {stageDisplay.label}
          </span>
        )}
        {character.messageCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
            <MessageCircle className="h-3 w-3" />
            {character.messageCount}
          </span>
        )}
      </div>

      {/* Bottom text overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h3 className="text-xl font-bold text-white drop-shadow-lg">
          {character.name}
        </h3>
        {meta && (
          <p className="mt-0.5 text-sm text-white/70 drop-shadow-md">
            {meta}
          </p>
        )}
        {character.job && (
          <p className="mt-0.5 text-xs text-white/50 drop-shadow-md">
            {character.job}
          </p>
        )}
      </div>

      {/* Hover glow ring */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5 transition-all duration-300 group-hover:ring-pink-500/20" />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-pink-500/10">
        <Sparkles className="h-10 w-10 text-pink-500" />
      </div>
      <h2 className="text-2xl font-bold text-white">No companions yet</h2>
      <p className="mt-2 max-w-md text-muted-foreground">
        Create your first AI companion to get started. Each companion has their
        own personality, memories, and story.
      </p>
      <Link
        href="/characters/create"
        className="mt-6 flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 crush-glow"
      >
        <Plus className="h-4 w-4" />
        Create Your First Companion
      </Link>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary/50 px-4 py-3 font-mono text-sm text-white/80">
        <Terminal className="h-4 w-4 text-pink-400" />
        <span>or: npx opencrush@latest create</span>
      </div>
    </div>
  );
}

export default function CharactersPage() {
  const characters = getCharacters();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Your Companions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {characters.length} companion{characters.length !== 1 ? "s" : ""} created
        </p>
      </div>

      {/* Content */}
      {characters.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {characters.map((character) => (
            <CharacterCard key={character.slug} character={character} />
          ))}

          {/* New Character Card */}
          <Link
            href="/characters/create"
            className="group relative flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] transition-all duration-300 hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--primary))]/5"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--primary))]/10 transition-transform duration-300 group-hover:scale-110">
              <Plus className="h-8 w-8 text-[hsl(var(--primary))]" />
            </div>
            <p className="mt-4 text-sm font-semibold text-white/70 group-hover:text-white">
              New Companion
            </p>
            <p className="mt-1 text-xs text-white/40">
              Create from dashboard
            </p>
          </Link>
        </div>
      )}
    </div>
  );
}
