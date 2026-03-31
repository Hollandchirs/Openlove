"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatWindow } from "./chat-window";
import { CharacterStatus } from "./character-status";
import { ActivityStatusBar } from "./activity-status";
import { WakeButton } from "./wake-button";
import type { CharacterSummary } from "@/lib/data";

interface ChatHomepageProps {
  characters: CharacterSummary[];
}

function CharacterSelector({
  characters,
  selected,
  onSelect,
}: {
  characters: CharacterSummary[];
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = characters.find((c) => c.slug === selected);

  if (characters.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 transition-colors hover:border-[hsl(var(--primary))]/30"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-[10px] font-bold text-white overflow-hidden">
          {current?.referenceImageRelative ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={current.referenceImageRelative}
              alt={current.name}
              className="h-full w-full object-cover"
            />
          ) : (
            current?.name.charAt(0).toUpperCase() ?? "?"
          )}
        </div>
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">
          {current?.name ?? "Select character"}
        </span>
        {current?.relationshipStage && (
          <span className="rounded-full bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
            {current.relationshipStage}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl">
            {characters.map((char) => (
              <button
                key={char.slug}
                type="button"
                onClick={() => {
                  onSelect(char.slug);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  char.slug === selected
                    ? "bg-[hsl(var(--primary))]/10"
                    : "hover:bg-[hsl(var(--secondary))]"
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-[10px] font-bold text-white overflow-hidden">
                  {char.referenceImageRelative ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={char.referenceImageRelative}
                      alt={char.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    char.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
                    {char.name}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {char.messageCount > 0
                      ? `${char.messageCount} messages`
                      : "No messages yet"}
                  </p>
                </div>
                {char.hasMemory && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NoCharactersState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--secondary))]">
        <MessageSquare className="h-10 w-10 text-[hsl(var(--muted-foreground))]/30" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">
          No characters yet
        </h2>
        <p className="mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
          Create your first AI companion to start chatting.
          Run{" "}
          <code className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 text-[hsl(var(--primary))]">
            npx opencrush@latest create
          </code>{" "}
          in your terminal.
        </p>
      </div>
    </div>
  );
}

export function ChatHomepage({ characters }: ChatHomepageProps) {
  const [selectedSlug, setSelectedSlug] = useState<string>(
    characters[0]?.slug ?? ""
  );

  const selectedChar = characters.find((c) => c.slug === selectedSlug);

  if (characters.length === 0) {
    return <NoCharactersState />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar with character selector */}
      <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 lg:px-6">
        <CharacterSelector
          characters={characters}
          selected={selectedSlug}
          onSelect={setSelectedSlug}
        />
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <ActivityStatusBar slug={selectedSlug} isChatActive />
          </div>
          <WakeButton slug={selectedSlug} />
        </div>
      </div>

      {/* Main content: chat + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat window */}
        <div className="flex-1 overflow-hidden">
          {selectedChar && (
            <ChatWindow
              key={selectedSlug}
              characterSlug={selectedSlug}
              characterName={selectedChar.name}
            />
          )}
        </div>

        {/* Status sidebar (hidden on mobile) */}
        {selectedChar && (
          <div className="hidden w-64 shrink-0 overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 xl:block">
            <CharacterStatus
              key={selectedSlug}
              slug={selectedSlug}
              name={selectedChar.name}
              isChatActive
            />
          </div>
        )}
      </div>
    </div>
  );
}
