"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Users, Settings, Menu, X, Heart, MessageCircle, Plus } from "lucide-react";
import type { CharacterSummary } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ActivityIndicator } from "./activity-status";
import { WakeIndicator } from "./wake-indicator";

interface SidebarProps {
  characters: CharacterSummary[];
}

const navItems = [
  { href: "/", label: "Chat", icon: MessageCircle },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

function CharacterAvatar({ character }: { character: CharacterSummary }) {
  const initials = character.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-xs font-semibold text-white overflow-hidden">
      {character.referenceImageRelative ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={character.referenceImageRelative}
          alt={character.name}
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
      {character.hasMemory && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--sidebar-bg))] bg-emerald-400" />
      )}
    </div>
  );
}

function SidebarContent({ characters, onNavigate }: SidebarProps & { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Branding */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-[hsl(var(--sidebar-border))] px-5">
        <Heart className="h-6 w-6 text-[hsl(var(--primary))]" fill="currentColor" />
        <span className="text-lg font-bold tracking-tight text-gradient-crush">
          Opencrush
        </span>
      </div>

      {/* Navigation */}
      <nav className="mt-4 space-y-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Character list */}
      <div className="mt-6 flex-1 overflow-y-auto px-3">
        <div className="mb-2 flex items-center justify-between px-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]/60">
            Your Characters
          </p>
          <Link
            href="/characters/create"
            onClick={onNavigate}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/60 transition-colors hover:bg-[hsl(var(--primary))]/10 hover:text-[hsl(var(--primary))]"
            title="Create new character"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="space-y-0.5">
          {characters.map((char) => {
            const charPath = `/characters/${char.slug}`;
            const isActive = pathname === charPath;

            return (
              <Link
                key={char.slug}
                href={charPath}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-[hsl(var(--foreground))]"
                )}
              >
                <CharacterAvatar character={char} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium">{char.name}</p>
                    <WakeIndicator slug={char.slug} />
                    <ActivityIndicator slug={char.slug} />
                  </div>
                  {char.messageCount > 0 && (
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                      {char.messageCount} messages
                    </p>
                  )}
                </div>
              </Link>
            );
          })}

          {characters.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-[hsl(var(--muted-foreground))]/50">
              No characters yet.
              <br />
              Run <code className="text-[hsl(var(--primary))]">opencrush create</code> to add one.
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[hsl(var(--sidebar-border))] px-5 py-3">
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]/40">
          Opencrush v0.1.1
        </p>
      </div>
    </div>
  );
}

export function Sidebar({ characters }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-[hsl(var(--sidebar-bg))] p-2 text-[hsl(var(--muted-foreground))] shadow-lg lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-50 flex h-full w-64 flex-col bg-[hsl(var(--sidebar-bg))]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              characters={characters}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-[hsl(var(--sidebar-border))] lg:bg-[hsl(var(--sidebar-bg))]">
        <SidebarContent characters={characters} />
      </aside>
    </>
  );
}
