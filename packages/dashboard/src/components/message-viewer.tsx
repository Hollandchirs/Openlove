"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Image as ImageIcon,
  Video,
  Info,
  X,
  Loader2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  role: string;
  content: string;
  timestamp: number;
  platform: string | null;
}

interface MessagesResponse {
  messages: Message[];
  total: number;
  page: number;
}

type MessageType = "text" | "image" | "video" | "system";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns true if the message is an internal system/trigger message that should be hidden */
function isSystemTrigger(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^\[.*trigger\]$/i.test(trimmed) ||
    /^\[.*update\]$/i.test(trimmed) ||
    /^\[proactive_/i.test(trimmed)
  );
}

function detectMessageType(content: string): MessageType {
  if (
    content.startsWith("[system]") ||
    content.startsWith("[System]") ||
    content.startsWith("---") ||
    isSystemTrigger(content)
  ) {
    return "system";
  }
  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(content) || content.startsWith("data:image/")) {
    return "image";
  }
  if (/\.(mp4|mov|webm|avi)(\?|$)/i.test(content)) {
    return "video";
  }
  return "text";
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) {
    const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${dayName} ${time}`;
  }
  return (
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }) + ` ${time}`
  );
}

function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function shouldShowDateSeparator(
  current: Message,
  previous: Message | undefined
): boolean {
  if (!previous) return true;
  const currentDay = new Date(current.timestamp).toDateString();
  const previousDay = new Date(previous.timestamp).toDateString();
  return currentDay !== previousDay;
}

function stripSystemPrefix(content: string): string {
  return content
    .replace(/^\[system\]\s*/i, "")
    .replace(/^---\s*/, "")
    .trim();
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DateSeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-white/5" />
      <span className="text-[11px] font-medium text-foreground/30 uppercase tracking-wider">
        {formatDateSeparator(timestamp)}
      </span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-center py-1.5">
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/5">
        <Info className="w-3 h-3 text-foreground/30" />
        <span className="text-xs text-foreground/40">
          {stripSystemPrefix(content)}
        </span>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  characterName,
  vibeColor,
  expanded,
  onToggle,
}: {
  message: Message;
  characterName: string;
  vibeColor: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUser = message.role === "user";
  const msgType = detectMessageType(message.content);
  const isLong = message.content.length > 300;
  const displayContent =
    !expanded && isLong
      ? message.content.slice(0, 300) + "..."
      : message.content;

  return (
    <div
      className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} group`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold mt-0.5"
        style={{
          backgroundColor: isUser ? "hsl(217 33% 20%)" : `${vibeColor}20`,
          color: isUser ? "hsl(215 20% 65%)" : vibeColor,
        }}
      >
        {isUser ? "U" : characterName.charAt(0).toUpperCase()}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] min-w-[80px] ${isUser ? "items-end" : "items-start"}`}
      >
        {/* Name + time */}
        <div
          className={`flex items-center gap-2 mb-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}
        >
          <span className="text-[11px] font-semibold text-foreground/50">
            {isUser ? "You" : characterName}
          </span>
          <span className="text-[10px] text-foreground/25">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        {/* Content bubble */}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed cursor-pointer transition-colors ${
            isUser
              ? "bg-[#1a5276] text-white/90 rounded-tr-md hover:bg-[#1d5b83]"
              : "bg-[hsl(222,30%,13%)] text-foreground/85 rounded-tl-md hover:bg-[hsl(222,30%,15%)]"
          }`}
          onClick={onToggle}
        >
          {msgType === "image" ? (
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 opacity-60" />
              <img
                src={message.content}
                alt="Shared image"
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = "none";
                  const parent = target.parentElement;
                  if (parent) {
                    const fallback = document.createElement("span");
                    fallback.textContent = "[Image]";
                    fallback.className = "text-foreground/50 italic";
                    parent.appendChild(fallback);
                  }
                }}
              />
            </div>
          ) : msgType === "video" ? (
            <div className="flex items-center gap-2 text-foreground/50">
              <Video className="w-4 h-4" />
              <span className="italic">[Video message]</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
          )}

          {/* Expand toggle for long messages */}
          {isLong && (
            <button
              className={`flex items-center gap-1 mt-1.5 text-[10px] font-medium ${
                isUser
                  ? "text-white/40 hover:text-white/60"
                  : "text-foreground/30 hover:text-foreground/50"
              } transition-colors`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" /> Show more
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface MessageViewerProps {
  characterName: string;
  characterSlug: string;
  vibeColor: string;
}

export default function MessageViewer({
  characterName,
  characterSlug,
  vibeColor,
}: MessageViewerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [initialLoad, setInitialLoad] = useState(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 50;

  // Fetch messages
  const fetchMessages = useCallback(
    async (pageNum: number, searchTerm: string, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: String(LIMIT),
        });
        if (searchTerm) {
          params.set("search", searchTerm);
        }

        const res = await fetch(
          `/api/messages/${characterSlug}?${params.toString()}`
        );
        if (!res.ok) throw new Error("Failed to fetch messages");
        const data: MessagesResponse = await res.json();

        if (append) {
          setMessages((prev) => [...data.messages, ...prev]);
        } else {
          setMessages(data.messages);
        }
        setTotal(data.total);
        setPage(pageNum);
      } catch {
        // silently handle - the UI will show empty state
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [characterSlug]
  );

  // Initial load: fetch last page (most recent messages)
  useEffect(() => {
    const loadLatest = async () => {
      setLoading(true);
      try {
        // First get total count to calculate last page
        const countRes = await fetch(
          `/api/messages/${characterSlug}?page=1&limit=1`
        );
        if (!countRes.ok) throw new Error("Failed to fetch");
        const countData: MessagesResponse = await countRes.json();
        const lastPage = Math.max(1, Math.ceil(countData.total / LIMIT));

        await fetchMessages(lastPage, "", false);
        setInitialLoad(false);
      } catch {
        setLoading(false);
        setInitialLoad(false);
      }
    };

    loadLatest();
  }, [characterSlug, fetchMessages]);

  // Auto-scroll to bottom on initial load and new messages
  useEffect(() => {
    if (!initialLoad && !loadingMore && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [messages.length, initialLoad, loadingMore]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setSearch(searchInput);
      if (searchInput.trim()) {
        fetchMessages(1, searchInput.trim(), false);
      } else {
        // Reset to latest messages
        const loadLatest = async () => {
          try {
            const countRes = await fetch(
              `/api/messages/${characterSlug}?page=1&limit=1`
            );
            if (!countRes.ok) return;
            const countData: MessagesResponse = await countRes.json();
            const lastPage = Math.max(1, Math.ceil(countData.total / LIMIT));
            await fetchMessages(lastPage, "", false);
          } catch {
            // ignore
          }
        };
        loadLatest();
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput, characterSlug, fetchMessages]);

  // Load older messages
  const loadOlder = useCallback(() => {
    if (page > 1 && !loadingMore && !search) {
      fetchMessages(page - 1, "", true);
    }
  }, [page, loadingMore, search, fetchMessages]);

  // Handle scroll to top for loading older messages
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (container.scrollTop < 60 && !loadingMore && page > 1 && !search) {
      loadOlder();
    }
  }, [loadOlder, loadingMore, page, search]);

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSearch = () => {
    setSearchInput("");
  };

  const hasMore = !search && page > 1;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col h-[600px] rounded-2xl glass-strong overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${vibeColor}18` }}
            >
              <MessageCircle
                className="w-4 h-4"
                style={{ color: vibeColor }}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Messages</h3>
              <p className="text-[11px] text-foreground/40">
                {total.toLocaleString()} message{total !== 1 ? "s" : ""}
                {search && " (filtered)"}
              </p>
            </div>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search messages..."
            className="w-full rounded-lg bg-white/[0.04] border border-white/5 pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-foreground/25 focus:outline-none focus:border-white/10 focus:bg-white/[0.06] transition-colors"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2
              className="w-6 h-6 animate-spin"
              style={{ color: vibeColor }}
            />
            <p className="text-sm text-foreground/30">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <MessageCircle className="w-10 h-10 text-foreground/10" />
            <p className="text-sm text-foreground/30">
              {search
                ? "No messages match your search."
                : `No conversations with ${characterName} yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Load older button */}
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={loadOlder}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-white/[0.04] border border-white/5 text-foreground/40 hover:text-foreground/60 hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ChevronUp className="w-3 h-3" />
                  )}
                  Load older messages
                </button>
              </div>
            )}

            {messages
              .filter((msg) => !isSystemTrigger(msg.content))
              .map((msg, i, filtered) => {
                const msgType = detectMessageType(msg.content);
                const prevMsg = i > 0 ? filtered[i - 1] : undefined;
                const showDate = shouldShowDateSeparator(msg, prevMsg);

                return (
                  <div key={`${msg.id}-${msg.timestamp}`}>
                    {showDate && <DateSeparator timestamp={msg.timestamp} />}
                    {msgType === "system" ? (
                      <SystemMessage content={msg.content} />
                    ) : (
                      <MessageBubble
                        message={msg}
                        characterName={characterName}
                        vibeColor={vibeColor}
                        expanded={expandedIds.has(msg.id)}
                        onToggle={() => toggleExpanded(msg.id)}
                      />
                    )}
                  </div>
                );
              })}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      {messages.length > 0 && (
        <div className="shrink-0 border-t border-white/5 px-4 py-2 flex items-center justify-between">
          <p className="text-[11px] text-foreground/25">
            {search
              ? `${messages.length} of ${total} results`
              : `Page ${page} of ${totalPages}`}
          </p>
          {search && total > messages.length && (
            <button
              onClick={() =>
                fetchMessages(
                  Math.min(page + 1, Math.ceil(total / LIMIT)),
                  search,
                  false
                )
              }
              className="text-[11px] font-medium hover:text-foreground/60 transition-colors"
              style={{ color: vibeColor }}
            >
              Load more results
            </button>
          )}
        </div>
      )}
    </div>
  );
}
