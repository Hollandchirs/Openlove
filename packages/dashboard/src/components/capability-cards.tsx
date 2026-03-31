"use client";

import { useEffect, useState } from "react";
import {
  Camera,
  Mic,
  Video,
  Globe,
  Twitter,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface OpencrushConfig {
  imageGeneration: { configured: boolean; model: string };
  voice: { provider: string; configured: boolean; conversationEnabled: boolean };
  twitter: { configured: boolean; autoPost: boolean; postInterval: number };
  browserAutomation: boolean;
}

interface Capability {
  id: string;
  label: string;
  icon: React.ElementType;
  enabled: boolean;
  description: string;
  action?: { label: string; onClick: () => void };
  detail?: string;
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge
      className="text-[10px] gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    >
      <CheckCircle2 className="w-2.5 h-2.5" />
      Active
    </Badge>
  ) : (
    <Badge
      className="text-[10px] gap-1 border-white/10 bg-white/5 text-foreground/40"
    >
      <XCircle className="w-2.5 h-2.5" />
      Not Configured
    </Badge>
  );
}

export function CapabilityCards({
  characterName,
  vibeColor,
}: {
  characterName: string;
  vibeColor: string;
}) {
  const [config, setConfig] = useState<OpencrushConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingState, setGeneratingState] = useState<Record<string, boolean>>({});
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load config");
        return res.json();
      })
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  function triggerSelfie() {
    setGeneratingState((prev) => ({ ...prev, selfie: true }));
    setResultMessage(null);

    fetch(`/api/media/${characterName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-selfie" }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setResultMessage(`Error: ${data.error}`);
        } else {
          setResultMessage(data.message ?? "Selfie generation started!");
        }
      })
      .catch((err) => {
        setResultMessage(`Error: ${err.message}`);
      })
      .finally(() => {
        setGeneratingState((prev) => ({ ...prev, selfie: false }));
      });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/30" />
      </div>
    );
  }

  const capabilities: Capability[] = [
    {
      id: "selfie",
      label: "Selfies",
      icon: Camera,
      enabled: config?.imageGeneration.configured ?? false,
      description: config?.imageGeneration.configured
        ? `Model: ${config.imageGeneration.model}`
        : "Add FAL_KEY to .env to enable",
      action: config?.imageGeneration.configured
        ? { label: "Generate Now", onClick: triggerSelfie }
        : undefined,
    },
    {
      id: "voice",
      label: "Voice",
      icon: Mic,
      enabled: config?.voice.configured ?? false,
      description: config?.voice.configured
        ? `Provider: ${config.voice.provider}${config.voice.conversationEnabled ? " + live conversation" : ""}`
        : "Add ELEVENLABS_API_KEY or FISH_AUDIO_API_KEY to .env",
    },
    {
      id: "video",
      label: "Video",
      icon: Video,
      enabled: config?.imageGeneration.configured ?? false,
      description: config?.imageGeneration.configured
        ? "Powered by fal.ai video models"
        : "Add FAL_KEY to .env to enable",
    },
    {
      id: "browser",
      label: "Browser",
      icon: Globe,
      enabled: config?.browserAutomation ?? false,
      description: config?.browserAutomation
        ? "Playwright browser automation active"
        : "Set BROWSER_AUTOMATION_ENABLED=true in .env",
    },
    {
      id: "twitter",
      label: "Twitter",
      icon: Twitter,
      enabled: config?.twitter.configured ?? false,
      description: config?.twitter.configured
        ? `Auto-post: ${config.twitter.autoPost ? "on" : "off"}, interval: ${config.twitter.postInterval}min`
        : "Add TWITTER_CLIENT_ID to .env",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {capabilities.map((cap) => (
          <div
            key={cap.id}
            className={`relative rounded-xl border p-4 transition-all ${
              cap.enabled
                ? "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]"
                : "border-white/5 bg-white/[0.02] opacity-60"
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg"
                  style={{
                    backgroundColor: cap.enabled
                      ? `${vibeColor}18`
                      : "rgba(255,255,255,0.05)",
                  }}
                >
                  <cap.icon
                    className="w-4 h-4"
                    style={{ color: cap.enabled ? vibeColor : undefined }}
                  />
                </div>
                <span className="text-sm font-medium">{cap.label}</span>
              </div>
              <StatusBadge enabled={cap.enabled} />
            </div>

            {/* Description */}
            <p className="text-xs text-foreground/45 leading-relaxed mb-3">
              {cap.description}
            </p>

            {/* Action button */}
            {cap.action && (
              <button
                onClick={cap.action.onClick}
                disabled={generatingState[cap.id]}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                style={{
                  backgroundColor: `${vibeColor}18`,
                  color: vibeColor,
                }}
              >
                {generatingState[cap.id] ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    {cap.action.label}
                  </>
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Result message toast */}
      {resultMessage && (
        <div
          className="mt-4 p-3 rounded-lg text-xs border"
          style={{
            backgroundColor: resultMessage.startsWith("Error")
              ? "rgba(239,68,68,0.1)"
              : `${vibeColor}10`,
            borderColor: resultMessage.startsWith("Error")
              ? "rgba(239,68,68,0.2)"
              : `${vibeColor}25`,
            color: resultMessage.startsWith("Error")
              ? "rgb(248,113,113)"
              : vibeColor,
          }}
        >
          {resultMessage}
          <button
            onClick={() => setResultMessage(null)}
            className="ml-2 opacity-60 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
