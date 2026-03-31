"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Image as ImageIcon,
  Video,
  Mic,
  Square,
  Play,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────

type MediaType = "image" | "video" | "audio";
type MessageType = "text" | MediaType;

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  platform: string | null;
  mediaUrl?: string;
  mediaType?: MediaType;
}

interface ChatAction {
  type: "send_image" | "send_voice" | "send_video" | string;
  prompt?: string;
  style?: string;
  text?: string;
}

interface ChatWindowProps {
  characterSlug: string;
  characterName: string;
}

interface MediaPreview {
  file: File;
  url: string;
  type: MediaType;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** Detect local media URLs (uploaded via /api/media/) in message content */
function extractMediaInfo(content: string): {
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  textContent: string;
} {
  const imageRegex = /(?:https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?|\/api\/media\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))/gi;
  const videoRegex = /\/api\/media\/[^\s]+\.(?:mp4|webm|mov)/gi;
  const audioRegex = /\/api\/media\/[^\s]+\.(?:webm|m4a|mp3|ogg|wav)/gi;

  const imageUrls = content.match(imageRegex) ?? [];
  const videoUrls = content.match(videoRegex) ?? [];
  const audioUrls = content.match(audioRegex) ?? [];

  // Remove media-related annotations from display text
  let textContent = content
    .replace(/\[User sent you (?:a photo|a video|a voice message)[^\]]*\]\n?/gi, "")
    .replace(imageRegex, "")
    .replace(videoRegex, "")
    .replace(audioRegex, "")
    // Strip leaked AI prompt text: [IMAGE: ...], [SELFIE: ...], [VIDEO: ...], [VOICE: ...]
    .replace(/\[(?:IMAGE|SELFIE|VIDEO|VOICE):\s*[^\]]*\]/gi, "")
    .replace(/\((?:IMAGE|SELFIE|VIDEO|VOICE):\s*[^)]*\)/gi, "")
    // Strip Chinese media annotations: [发送照片：...], [发送视频：...]
    .replace(/\[发送(?:照片|视频|语音)：[^\]]*\]/g, "")
    .trim();

  return { imageUrls, videoUrls, audioUrls, textContent };
}

/** Returns true if the message is an internal system/trigger message that should be hidden */
function isSystemMessage(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^\[.*trigger\]$/i.test(trimmed) ||
    /^\[.*update\]$/i.test(trimmed) ||
    /^\[proactive_/i.test(trimmed) ||
    // Leaked AI prompt text — media generation instructions that leaked into stored messages.
    // Use \s after colon to avoid matching actual stored media markers like [image:/api/...].
    // Stored media markers have a URL (no space) right after the colon.
    /^\[IMAGE:\s/i.test(trimmed) ||
    /^\[VIDEO:\s/i.test(trimmed) ||
    /^\[VOICE:\s/i.test(trimmed) ||
    /^\[SELFIE:\s/i.test(trimmed) ||
    /^\(IMAGE:\s/i.test(trimmed) ||
    /^\(VIDEO:\s/i.test(trimmed) ||
    /^\(VOICE:\s/i.test(trimmed) ||
    /^\(SELFIE:\s/i.test(trimmed)
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Audio player for voice messages ─────────────────────────────────────

function VoicePlayer({ url, isUser }: { url: string; isUser: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-2.5",
        isUser
          ? "rounded-br-md bg-[hsl(var(--primary))] text-white"
          : "glass rounded-bl-md text-[hsl(var(--foreground))]"
      )}
      style={{ minWidth: 200 }}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-white/20 hover:bg-white/30"
            : "bg-[hsl(var(--primary))]/20 hover:bg-[hsl(var(--primary))]/30"
        )}
      >
        {playing ? (
          <Square className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3 ml-0.5" />
        )}
      </button>
      <div className="flex-1">
        <div
          className={cn(
            "h-1 rounded-full overflow-hidden",
            isUser ? "bg-white/20" : "bg-[hsl(var(--muted-foreground))]/20"
          )}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isUser ? "bg-white" : "bg-[hsl(var(--primary))]"
            )}
            style={{
              width:
                duration != null && duration > 0
                  ? `${(currentTime / duration) * 100}%`
                  : "0%",
            }}
          />
        </div>
      </div>
      <span className="text-xs opacity-70 tabular-nums">
        {duration == null
          ? "--:--"
          : playing
            ? formatDuration(currentTime)
            : formatDuration(duration)}
      </span>
    </div>
  );
}

// ── Media generation indicator ───────────────────────────────────────────

function GeneratingMediaIndicator({
  name,
  mediaType,
}: {
  name: string;
  mediaType: "image" | "voice" | "video";
}) {
  const labels: Record<string, string> = {
    image: "sending selfie...",
    voice: "sending voice...",
    video: "sending video...",
  };
  const label = labels[mediaType] ?? "generating media...";
  return (
    <div className="flex items-end gap-2.5 px-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-[10px] font-bold text-white">
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="glass rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────

function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="flex items-end gap-2.5 px-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-[10px] font-bold text-white">
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="glass rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

// ── Chat image with error fallback ──────────────────────────────────────

function ChatImage({ url }: { url: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex items-center gap-2 overflow-hidden rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Shared image"
        className="max-h-64 max-w-full rounded-xl object-cover"
        loading="lazy"
        onError={() => setError(true)}
      />
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────

function MessageBubble({
  message,
  characterName,
}: {
  message: ChatMessage;
  characterName: string;
}) {
  const isUser = message.role === "user";

  // Check for explicit media attachment first, then parse content
  const hasExplicitMedia = message.mediaUrl && message.mediaType;
  const { imageUrls, videoUrls, audioUrls, textContent } = extractMediaInfo(
    message.content
  );

  // Combine explicit media with parsed media
  const allImages = hasExplicitMedia && message.mediaType === "image"
    ? [message.mediaUrl!, ...imageUrls]
    : imageUrls;
  const allVideos = hasExplicitMedia && message.mediaType === "video"
    ? [message.mediaUrl!, ...videoUrls]
    : videoUrls;
  const allAudios = hasExplicitMedia && message.mediaType === "audio"
    ? [message.mediaUrl!, ...audioUrls]
    : audioUrls;

  return (
    <div
      className={cn(
        "flex items-end gap-2.5 px-4",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(330,60%,40%)] text-[10px] font-bold text-white">
          {characterName.charAt(0).toUpperCase()}
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] space-y-1.5",
          isUser ? "items-end" : "items-start"
        )}
      >
        {/* Inline images */}
        {allImages.map((url, i) => (
          <ChatImage key={`img-${i}`} url={url} />
        ))}

        {/* Inline videos */}
        {allVideos.map((url, i) => (
          <div key={`vid-${i}`} className="overflow-hidden rounded-xl">
            <video
              src={url}
              controls
              preload="metadata"
              className="max-h-64 max-w-full rounded-xl"
            />
          </div>
        ))}

        {/* Voice messages */}
        {allAudios.map((url, i) => (
          <VoicePlayer key={`aud-${i}`} url={url} isUser={isUser} />
        ))}

        {/* Text bubble */}
        {textContent && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "rounded-br-md bg-[hsl(var(--primary))] text-white"
                : "glass rounded-bl-md text-[hsl(var(--foreground))]"
            )}
          >
            <p className="whitespace-pre-wrap break-words">{textContent}</p>
          </div>
        )}

        {/* Timestamp */}
        <p
          className={cn(
            "px-1 text-[10px] text-[hsl(var(--muted-foreground))]/50",
            isUser ? "text-right" : "text-left"
          )}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ name }: { name: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))]/20 to-[hsl(330,60%,40%)]/20">
        <span className="text-3xl font-bold text-gradient-crush">
          {name.charAt(0).toUpperCase()}
        </span>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Start talking to {name}
        </h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Send a message to begin your conversation.
        </p>
      </div>
    </div>
  );
}

// ── Media preview bar ────────────────────────────────────────────────────

function MediaPreviewBar({
  preview,
  onClear,
}: {
  preview: MediaPreview;
  onClear: () => void;
}) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-3 rounded-lg bg-[hsl(var(--secondary))] p-2">
      {preview.type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.url}
          alt="Preview"
          className="h-16 w-16 rounded-lg object-cover"
        />
      )}
      {preview.type === "video" && (
        <div className="relative flex h-16 w-16 items-center justify-center rounded-lg bg-black/50">
          <video
            src={preview.url}
            className="h-16 w-16 rounded-lg object-cover"
          />
          <Play className="absolute h-6 w-6 text-white/80" />
        </div>
      )}
      {preview.type === "audio" && (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[hsl(var(--primary))]/10">
          <Mic className="h-6 w-6 text-[hsl(var(--primary))]" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm text-[hsl(var(--foreground))]">
          {preview.file.name}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {(preview.file.size / 1024).toFixed(0)} KB
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--border))]"
      >
        <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      </button>
    </div>
  );
}

// ── Main chat window ─────────────────────────────────────────────────────

export function ChatWindow({ characterSlug, characterName }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [generatingMedia, setGeneratingMedia] = useState<"image" | "voice" | "video" | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load message history — fetch the MOST RECENT messages, not the oldest.
  // First get total count, then request the last PAGE_SIZE messages using an
  // explicit offset so we always get a full page of the newest messages.
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setError(null);

    const PAGE_SIZE = 50;

    const loadLatestMessages = async () => {
      try {
        // Step 1: get total count
        const countRes = await fetch(`/api/messages/${characterSlug}?page=1&limit=1`);
        if (!countRes.ok) throw new Error("Failed to fetch message count");
        const countData = await countRes.json();
        const total: number = countData.total ?? 0;

        if (total === 0) {
          setMessages([]);
          return;
        }

        // Step 2: fetch the last PAGE_SIZE messages using explicit offset.
        // When total=51 and PAGE_SIZE=50, offset=1 gives messages 2-51 (newest 50).
        // The old page-based approach would calculate page=2, offset=50, returning
        // only 1 message (the 51st) instead of 50.
        const offset = Math.max(0, total - PAGE_SIZE);
        const res = await fetch(
          `/api/messages/${characterSlug}?limit=${PAGE_SIZE}&offset=${offset}`
        );
        if (!res.ok) throw new Error("Failed to fetch messages");
        const data = await res.json();

        const msgs = ((data.messages ?? []) as ChatMessage[])
          .filter((m) => !isSystemMessage(m.content ?? ""))
          .map((m) => {
            // Restore image/voice messages from [image:url] / [voice:url] format
            // Handle both [image:url] and [image:url (missing closing bracket)
            // Also handles [image:url|model:fal-ai/flux-pulid] format (strip model attribution)
            // Trim content to handle any leading/trailing whitespace from DB
            const content = (m.content ?? "").trim();
            const imgMatch = content.match(/^\[image:(.*?)(?:\|model:[^\]]*)?(?:\]|$)/);
            if (imgMatch) {
              return { ...m, content: '', mediaUrl: imgMatch[1].trim(), mediaType: 'image' as MediaType };
            }
            const voiceMatch = content.match(/^\[voice:(.*?)(?:\]|$)/);
            if (voiceMatch) {
              return { ...m, content: '', mediaUrl: voiceMatch[1].trim(), mediaType: 'audio' as MediaType };
            }
            const videoMatch = content.match(/^\[video:(.*?)(?:\|model:[^\]]*)?(?:\]|$)/);
            if (videoMatch) {
              return { ...m, content: '', mediaUrl: videoMatch[1].trim(), mediaType: 'video' as MediaType };
            }
            return m;
          });
        setMessages(msgs);
      } catch (err) {
        console.error("[chat] Failed to load messages:", err);
        setError("Failed to load messages");
      } finally {
        setLoading(false);
      }
    };

    loadLatestMessages();
  }, [characterSlug]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, generatingMedia, scrollToBottom]);

  // Auto-focus input
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading, characterSlug]);

  // Cleanup media preview URL on unmount or change
  useEffect(() => {
    return () => {
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview.url);
      }
    };
  }, [mediaPreview]);

  // Upload file to server
  const uploadFile = useCallback(
    async (file: File): Promise<{ url: string; type: MediaType } | null> => {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch(`/api/chat/${characterSlug}/upload`, {
          method: "POST",
          body: formData,
        });

        const data = await resp.json();

        if (!resp.ok) {
          setError(data.error ?? "Upload failed");
          return null;
        }

        return { url: data.url, type: data.type };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        return null;
      } finally {
        setUploading(false);
      }
    },
    [characterSlug]
  );

  // Send message (with optional media)
  const sendMessage = useCallback(
    async (
      text: string,
      mediaFile?: File,
      mediaType?: MediaType
    ) => {
      const trimmed = text.trim();
      const hasMedia = mediaFile && mediaType;
      if (!trimmed && !hasMedia) return;
      if (sending || uploading) return;

      setError(null);
      setSending(true);
      setInput("");

      // Clear preview
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview.url);
        setMediaPreview(null);
      }

      // Upload media file first if present
      let uploadedUrl = "";
      let uploadedType: MediaType | undefined;

      if (hasMedia) {
        const result = await uploadFile(mediaFile);
        if (!result) {
          setSending(false);
          return;
        }
        uploadedUrl = result.url;
        uploadedType = result.type;
      }

      // Build display content — don't include the URL in content when mediaUrl is set,
      // otherwise MessageBubble merges both sources and shows the media twice.
      const displayContent = trimmed;

      // Optimistic add
      const userMsg: ChatMessage = {
        id: Date.now(),
        role: "user",
        content: displayContent || (uploadedType === "audio" ? "Voice message" : ""),
        timestamp: Date.now(),
        platform: "dashboard",
        mediaUrl: uploadedUrl || undefined,
        mediaType: uploadedType,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const resp = await fetch(`/api/chat/${characterSlug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed || (uploadedType === "audio" ? "Voice message" : "Sent a file"),
            type: uploadedType ?? "text",
            mediaUrl: uploadedUrl || undefined,
          }),
        });

        const data = await resp.json();

        if (!resp.ok) {
          setError(data.error ?? "Something went wrong");
          setSending(false);
          return;
        }

        // Process actions (send_image, send_voice) — only first of each type
        const actions = (data.actions ?? []) as ChatAction[];

        // When the response includes a media action (send_image, send_voice),
        // the LLM reply often contains only roleplay narration like
        // "(picks up phone and takes a selfie)" or "*sends a photo*" with no
        // meaningful conversational text. Showing that as a separate text bubble
        // alongside the generated image causes the "two messages" bug.
        // Strip narration and media annotations; only show the text bubble if
        // there is real conversational content left.
        const hasMediaAction = actions.some(
          (a) => a.type === "send_image" || a.type === "send_voice" || a.type === "send_video"
        );

        const replyText: string = data.reply ?? "";
        let displayText = replyText;
        let showTextBubble = true;

        if (hasMediaAction) {
          // When a media action is present, the LLM reply often contains
          // narration like "(picks up phone)" or filler like "Here you go!".
          // Strip narration and short filler, but KEEP real conversational
          // content so "take a selfie and tell me about X" still shows both
          // the selfie and the text answer.
          const stripped = replyText
            // Strip roleplay narration in parentheses/asterisks
            .replace(/\([^)]*\)\s*/g, "")
            .replace(/\*[^*]{2,60}\*\s*/g, "")
            // Strip media action tags that leaked into text
            .replace(/\[(?:SELFIE|IMAGE|VIDEO|VOICE):\s*[^\]]*\]/gi, "")
            .replace(/\((?:SELFIE|IMAGE|VIDEO|VOICE):\s*[^)]*\)/gi, "")
            // Strip Chinese media annotations
            .replace(/\[发送(?:照片|视频|语音)[：:][^\]]*\]/g, "")
            .trim();

          // Only suppress the text bubble if the remaining text is empty,
          // whitespace-only, or just short filler (< 20 chars that match
          // common throwaway phrases).
          const isFillerOnly =
            stripped.length === 0 ||
            /^(here\s*(you\s*go|it\s*is|is\s*one|this\s*is)|ta-da|voil[àa]|enjoy|check\s*(this|it)\s*out|sent|done|there\s*you\s*go|for\s*you|hope\s*you\s*like\s*it)[.!~✨💕🥰😊]*$/i.test(
              stripped
            );

          if (isFillerOnly) {
            showTextBubble = false;
          } else {
            // Show the cleaned text alongside the media
            displayText = stripped;
          }
        }

        if (showTextBubble && displayText.length > 0) {
          const assistantMsg: ChatMessage = {
            id: Date.now() + 1,
            role: "assistant",
            content: displayText,
            timestamp: data.timestamp,
            platform: "dashboard",
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
        const handledTypes = new Set<string>();
        for (const action of actions) {
          if (handledTypes.has(action.type)) continue;
          handledTypes.add(action.type);
          if (action.type === "send_image" && action.prompt) {
            setGeneratingMedia("image");
            try {
              const imgResp = await fetch(
                `/api/chat/${characterSlug}/generate-image`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    prompt: action.prompt,
                    style: action.style ?? "casual",
                  }),
                }
              );
              const imgData = await imgResp.json();
              if (imgResp.ok && imgData.url) {
                const imgMsg: ChatMessage = {
                  id: Date.now() + 2,
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                  platform: "dashboard",
                  mediaUrl: imgData.url,
                  mediaType: "image",
                };
                setMessages((prev) => [...prev, imgMsg]);
              } else {
                const reason = imgData.error ?? "Unknown error";
                setError(`Image generation failed: ${reason}`);
                setTimeout(() => setError(null), 5000);
              }
            } catch (imgErr) {
              const reason = imgErr instanceof Error ? imgErr.message : "Network error";
              setError(`Image generation failed: ${reason}`);
              setTimeout(() => setError(null), 5000);
            } finally {
              setGeneratingMedia(null);
            }
          }

          if (action.type === "send_voice") {
            const voiceText = action.text ?? data.reply;
            setGeneratingMedia("voice");
            try {
              const voiceResp = await fetch(
                `/api/chat/${characterSlug}/generate-voice`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: voiceText }),
                }
              );
              const voiceData = await voiceResp.json();
              if (voiceResp.ok && voiceData.url) {
                const voiceMsg: ChatMessage = {
                  id: Date.now() + 3,
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                  platform: "dashboard",
                  mediaUrl: voiceData.url,
                  mediaType: "audio",
                };
                setMessages((prev) => [...prev, voiceMsg]);
              } else {
                const reason = voiceData.error ?? "Unknown error";
                setError(`Voice generation failed: ${reason}`);
                setTimeout(() => setError(null), 5000);
              }
            } catch (voiceErr) {
              const reason = voiceErr instanceof Error ? voiceErr.message : "Network error";
              setError(`Voice generation failed: ${reason}`);
              setTimeout(() => setError(null), 5000);
            } finally {
              setGeneratingMedia(null);
            }
          }

          if (action.type === "send_video" && action.prompt) {
            setGeneratingMedia("video");
            try {
              const vidResp = await fetch(
                `/api/chat/${characterSlug}/generate-video`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    prompt: action.prompt,
                    style: action.style,
                  }),
                }
              );
              const vidData = await vidResp.json();
              if (vidResp.ok && vidData.url) {
                const vidMsg: ChatMessage = {
                  id: Date.now() + 4,
                  role: "assistant",
                  content: "",
                  timestamp: Date.now(),
                  platform: "dashboard",
                  mediaUrl: vidData.url,
                  mediaType: "video",
                };
                setMessages((prev) => [...prev, vidMsg]);
              } else {
                const reason = vidData.error ?? "Unknown error";
                setError(`Video generation failed: ${reason}`);
                setTimeout(() => setError(null), 5000);
              }
            } catch (vidErr) {
              const reason = vidErr instanceof Error ? vidErr.message : "Network error";
              setError(`Video generation failed: ${reason}`);
              setTimeout(() => setError(null), 5000);
            } finally {
              setGeneratingMedia(null);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [characterSlug, sending, uploading, mediaPreview, uploadFile]
  );

  // Handle enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mediaPreview) {
        sendMessage(input, mediaPreview.file, mediaPreview.type);
      } else {
        sendMessage(input);
      }
    }
  };

  // Handle file selection (image or video)
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      let type: MediaType;
      if (file.type.startsWith("video/")) {
        type = "video";
      } else if (file.type.startsWith("audio/")) {
        type = "audio";
      } else {
        type = "image";
      }

      // Clean up previous preview
      if (mediaPreview) {
        URL.revokeObjectURL(mediaPreview.url);
      }

      setMediaPreview({
        file,
        url: URL.createObjectURL(file),
        type,
      });

      inputRef.current?.focus();
    },
    [mediaPreview]
  );

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const clearPreview = useCallback(() => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview.url);
      setMediaPreview(null);
    }
  }, [mediaPreview]);

  const isBusy = sending || uploading;

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--muted-foreground))]" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState name={characterName} />
        ) : (
          <div className="space-y-3 py-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                characterName={characterName}
              />
            ))}
            {sending && <TypingIndicator name={characterName} />}
            {generatingMedia && (
              <GeneratingMediaIndicator
                name={characterName}
                mediaType={generatingMedia}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 mx-4 mb-2 rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Media preview */}
      {mediaPreview && (
        <div className="shrink-0">
          <MediaPreviewBar preview={mediaPreview} onClear={clearPreview} />
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {/* Hidden file inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Image button */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isBusy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:opacity-30"
            title="Send image"
          >
            <ImageIcon className="h-4 w-4" />
          </button>

          {/* Video button */}
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={isBusy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:opacity-30"
            title="Send video"
          >
            <Video className="h-4 w-4" />
          </button>

          {/* Text input */}
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                mediaPreview
                  ? "Add a caption..."
                  : `Message ${characterName}...`
              }
              rows={1}
              disabled={isBusy}
              className="w-full resize-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-2.5 pr-12 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]/50 focus:border-[hsl(var(--primary))]/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
              style={{ maxHeight: "160px" }}
            />
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={() => {
              if (mediaPreview) {
                sendMessage(input, mediaPreview.file, mediaPreview.type);
              } else {
                sendMessage(input);
              }
            }}
            disabled={isBusy || (!input.trim() && !mediaPreview)}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
              (input.trim() || mediaPreview) && !isBusy
                ? "bg-[hsl(var(--primary))] text-white hover:opacity-90 crush-glow"
                : "text-[hsl(var(--muted-foreground))]/30"
            )}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
