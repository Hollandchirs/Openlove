"use client";

import { useEffect, useState, useCallback } from "react";
import { Image as ImageIcon, X, Filter, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MediaFile {
  filename: string;
  type: "selfie" | "card" | "reference" | "other";
  url: string;
  size: number;
  modifiedAt: number;
}

type FilterType = "all" | "selfie" | "card" | "reference";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function Lightbox({
  file,
  onClose,
  vibeColor,
}: {
  file: MediaFile;
  onClose: () => void;
  vibeColor: string;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 p-2 text-white/60 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Image */}
        <img
          src={file.url}
          alt={file.filename}
          className="max-w-full max-h-[85vh] rounded-xl object-contain"
          style={{
            boxShadow: `0 25px 80px ${vibeColor}30`,
          }}
        />

        {/* Info bar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                className="text-xs capitalize"
                style={{
                  backgroundColor: `${vibeColor}20`,
                  color: vibeColor,
                  borderColor: `${vibeColor}40`,
                }}
              >
                {file.type}
              </Badge>
              <span className="text-xs text-white/50">
                {formatFileSize(file.size)}
              </span>
            </div>
            <span className="text-xs text-white/50 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(file.modifiedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MediaGallery({
  characterName,
  vibeColor,
}: {
  characterName: string;
  vibeColor: string;
}) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selected, setSelected] = useState<MediaFile | null>(null);

  useEffect(() => {
    fetch(`/api/media/${characterName}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load media");
        return res.json();
      })
      .then((data) => setFiles(data.files))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [characterName]);

  const closeLightbox = useCallback(() => setSelected(null), []);

  const filteredFiles =
    filter === "all" ? files : files.filter((f) => f.type === filter);

  const availableTypes = Array.from(new Set(files.map((f) => f.type)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/30" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-foreground/40">
        <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-foreground/40">
        <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">No media files yet</p>
        <p className="text-xs mt-1 text-foreground/25">
          Generated selfies and cards will appear here
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      {availableTypes.length > 1 && (
        <div className="flex items-center gap-2 mb-5">
          <Filter className="w-3.5 h-3.5 text-foreground/40" />
          <div className="flex gap-1.5">
            {(["all", ...availableTypes] as FilterType[]).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  filter === type
                    ? "text-white"
                    : "text-foreground/50 hover:text-foreground/70 bg-white/5 hover:bg-white/8"
                }`}
                style={
                  filter === type
                    ? { backgroundColor: `${vibeColor}30`, color: vibeColor }
                    : undefined
                }
              >
                {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
                {type === "all"
                  ? ` (${files.length})`
                  : ` (${files.filter((f) => f.type === type).length})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Masonry grid */}
      <div className="columns-2 md:columns-3 gap-3 space-y-3">
        {filteredFiles.map((file) => (
          <button
            key={file.filename}
            onClick={() => setSelected(file)}
            className="relative w-full break-inside-avoid group cursor-pointer rounded-xl overflow-hidden bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all"
          >
            <img
              src={file.url}
              alt={file.filename}
              className="w-full block"
              loading="lazy"
            />

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="flex items-center justify-between">
                  <Badge
                    className="text-[10px] capitalize"
                    style={{
                      backgroundColor: `${vibeColor}25`,
                      color: vibeColor,
                      borderColor: `${vibeColor}40`,
                    }}
                  >
                    {file.type}
                  </Badge>
                  <span className="text-[10px] text-white/50">
                    {formatTimestamp(file.modifiedAt)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {selected && (
        <Lightbox
          file={selected}
          onClose={closeLightbox}
          vibeColor={vibeColor}
        />
      )}
    </div>
  );
}
