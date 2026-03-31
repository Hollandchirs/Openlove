"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Save, FileText, Eye, Pencil, Loader2, Check, AlertCircle } from "lucide-react";

const ALLOWED_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md"] as const;
type AllowedFile = (typeof ALLOWED_FILES)[number];

interface MdEditorProps {
  characterName: string;
  vibeColor: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function MdEditor({ characterName, vibeColor }: MdEditorProps) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<AllowedFile>("IDENTITY.md");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const originalFiles = useRef<Record<string, string>>({});

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/character/${characterName}/files`);
      if (!res.ok) throw new Error("Failed to load files");
      const data = await res.json();
      setFiles(data.files);
      originalFiles.current = { ...data.files };
      setDirty(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [characterName]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleContentChange = (value: string) => {
    const updatedFiles = { ...files, [activeFile]: value };
    setFiles(updatedFiles);

    const newDirty = new Set(dirty);
    if (value !== originalFiles.current[activeFile]) {
      newDirty.add(activeFile);
    } else {
      newDirty.delete(activeFile);
    }
    setDirty(newDirty);
    setSaveStatus("idle");
  };

  const handleSave = async () => {
    if (dirty.size === 0) return;

    setSaveStatus("saving");
    try {
      const promises = Array.from(dirty).map((filename) =>
        fetch(`/api/character/${characterName}/files`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, content: files[filename] }),
        }).then((res) => {
          if (!res.ok) throw new Error(`Failed to save ${filename}`);
          return res.json();
        })
      );

      await Promise.all(promises);
      originalFiles.current = { ...files };
      setDirty(new Set());
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setSaveStatus("error");
      setError(err instanceof Error ? err.message : "Failed to save");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
        <span className="ml-2 text-sm text-foreground/40">Loading files...</span>
      </div>
    );
  }

  if (error && Object.keys(files).length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <span className="ml-2 text-sm text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        {/* File tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
          {ALLOWED_FILES.map((filename) => {
            const isActive = activeFile === filename;
            const isDirty = dirty.has(filename);
            return (
              <button
                key={filename}
                onClick={() => setActiveFile(filename)}
                className={`
                  relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all
                  ${isActive
                    ? "bg-white/10 text-foreground shadow-sm"
                    : "text-foreground/50 hover:text-foreground/70 hover:bg-white/5"
                  }
                `}
                style={isActive ? { borderBottom: `2px solid ${vibeColor}` } : undefined}
              >
                <FileText className="w-3 h-3" />
                {filename.replace(".md", "")}
                {isDirty && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: vibeColor }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Read-only toggle */}
          <button
            onClick={() => setReadOnly((prev) => !prev)}
            className={`
              flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all
              ${readOnly
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-white/5 text-foreground/60 hover:text-foreground/80"
              }
            `}
          >
            {readOnly ? <Eye className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            {readOnly ? "Read-only" : "Editing"}
          </button>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={dirty.size === 0 || saveStatus === "saving"}
            className={`
              flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-all
              ${dirty.size > 0
                ? "text-white shadow-lg"
                : "bg-white/5 text-foreground/30 cursor-not-allowed"
              }
            `}
            style={
              dirty.size > 0
                ? { backgroundColor: vibeColor, boxShadow: `0 4px 12px ${vibeColor}40` }
                : undefined
            }
          >
            {saveStatus === "saving" && <Loader2 className="w-3 h-3 animate-spin" />}
            {saveStatus === "saved" && <Check className="w-3 h-3" />}
            {saveStatus === "error" && <AlertCircle className="w-3 h-3" />}
            {saveStatus === "idle" && <Save className="w-3 h-3" />}
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Unsaved indicator */}
      {dirty.size > 0 && (
        <div className="flex items-center gap-2 text-xs text-foreground/40">
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: vibeColor }}
          />
          {dirty.size} unsaved file{dirty.size > 1 ? "s" : ""} — Cmd+S to save
        </div>
      )}

      {/* Editor */}
      <div className="relative rounded-xl border border-white/10 bg-[#0d1117] overflow-hidden">
        {/* File header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <FileText className="w-3.5 h-3.5 text-foreground/30" />
          <span className="text-xs text-foreground/50 font-mono">{activeFile}</span>
          {dirty.has(activeFile) && (
            <span className="text-xs text-foreground/30 ml-auto">modified</span>
          )}
        </div>

        <textarea
          value={files[activeFile] ?? ""}
          onChange={(e) => handleContentChange(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          className={`
            w-full min-h-[500px] p-4 bg-transparent text-sm text-foreground/90
            font-mono leading-relaxed resize-y
            focus:outline-none
            placeholder:text-foreground/20
            ${readOnly ? "cursor-default opacity-70" : ""}
          `}
          placeholder={`# ${activeFile.replace(".md", "")}\n\nStart writing...`}
        />
      </div>

      {/* Error toast */}
      {error && saveStatus === "error" && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
