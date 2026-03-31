"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Key,
  Bot,
  MessageSquare,
  Clock,
  Zap,
  Twitter,
  Save,
  Eye,
  EyeOff,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Image,
  Mic,
  Globe,
  Users,
  Phone,
} from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { Collapsible } from "../../components/ui/collapsible";
import { Badge } from "../../components/ui/badge";

// ── Types ──

interface SettingsData {
  llmProvider: string;
  llmModel: string;
  characterName: string;
  keys: Record<string, string>;
  discord: { enabled: boolean; botToken: string; clientId: string; ownerId: string };
  telegram: { enabled: boolean; botToken: string; ownerId: string };
  whatsapp: { enabled: boolean };
  twitter: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
    autoPost: boolean;
    postInterval: number;
  };
  imageGeneration: { enabled: boolean; falKey: string; model: string };
  voice: { provider: string; enabled: boolean; conversationEnabled: boolean; elevenlabsKey: string; fishAudioKey: string };
  browserAutomation: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  proactiveMinInterval: number;
  proactiveMaxInterval: number;
}

interface CharacterConfig {
  readonly discord: {
    readonly enabled: boolean;
    readonly botToken: string;
    readonly clientId: string;
    readonly ownerId: string;
  };
  readonly telegram: {
    readonly enabled: boolean;
    readonly botToken: string;
    readonly ownerId: string;
  };
  readonly whatsapp: { readonly enabled: boolean };
  readonly voice: {
    readonly provider: "elevenlabs" | "fish_audio" | "";
    readonly elevenlabsKey: string;
    readonly elevenlabsVoiceId: string;
    readonly fishAudioKey: string;
    readonly fishAudioVoiceId: string;
    readonly conversationEnabled: boolean;
  };
  readonly twitter: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly apiKey: string;
    readonly apiSecret: string;
    readonly accessToken: string;
    readonly accessSecret: string;
    readonly autoPost: boolean;
    readonly postInterval: number;
  };
  readonly autonomous: {
    readonly quietHoursStart: number;
    readonly quietHoursEnd: number;
    readonly proactiveMinInterval: number;
    readonly proactiveMaxInterval: number;
  };
}

function getDefaultCharacterConfig(): CharacterConfig {
  return {
    discord: { enabled: false, botToken: "", clientId: "", ownerId: "" },
    telegram: { enabled: false, botToken: "", ownerId: "" },
    whatsapp: { enabled: false },
    voice: {
      provider: "",
      elevenlabsKey: "",
      elevenlabsVoiceId: "",
      fishAudioKey: "",
      fishAudioVoiceId: "",
      conversationEnabled: false,
    },
    twitter: {
      clientId: "",
      clientSecret: "",
      apiKey: "",
      apiSecret: "",
      accessToken: "",
      accessSecret: "",
      autoPost: false,
      postInterval: 120,
    },
    autonomous: {
      quietHoursStart: 23,
      quietHoursEnd: 8,
      proactiveMinInterval: 60,
      proactiveMaxInterval: 240,
    },
  };
}

// ── Helpers ──

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? "****" : "";
  const dashIdx = key.indexOf("-");
  const prefix = key.slice(0, dashIdx >= 0 ? dashIdx + 1 : 4);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

const LLM_PROVIDERS = [
  // Chinese providers (no VPN)
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "Qwen" },
  { value: "kimi", label: "Kimi" },
  { value: "zhipu", label: "Zhipu (China)" },
  { value: "minimax", label: "MiniMax (China)" },
  { value: "minimax-global", label: "MiniMax (Global)" },
  { value: "zai", label: "Z.ai (Global)" },
  // International (needs VPN in CN)
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "openai", label: "OpenAI GPT" },
  { value: "xai", label: "xAI Grok" },
  // Google Gemini: backend not yet implemented — hidden until ready
  // { value: "google", label: "Google Gemini" },
  // Local
  { value: "ollama", label: "Ollama (Local)" },
];

const TTS_PROVIDERS = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "fish_audio", label: "Fish Audio" },
];

const VOICE_PROVIDERS = [
  { value: "", label: "None" },
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "fish_audio", label: "Fish Audio" },
];

// ── Sub-components ──

function StatusDot({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "ghost"} className={active ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : ""}>
      {active ? "Connected" : "Not configured"}
    </Badge>
  );
}

function MaskedKeyField({
  label,
  envKey,
  value,
  onChange,
}: {
  label: string;
  envKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const handleSave = () => {
    onChange(envKey, localValue);
    setEditing(false);
    setRevealed(false);
  };

  const handleCancel = () => {
    setLocalValue(value);
    setEditing(false);
    setRevealed(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 py-2">
        <label className="min-w-0 shrink-0 text-sm text-zinc-400">{label}</label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-zinc-300">
            {value ? maskKey(value) : <span className="text-zinc-600">not set</span>}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setEditing(true); setLocalValue(value); }}
            className="h-7 px-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-zinc-900/50 p-3">
      <label className="text-sm font-medium text-zinc-300">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={revealed ? "text" : "password"}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder={`Enter ${label}`}
            className="pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <Button size="sm" onClick={handleSave} className="h-9">
          <Check className="mr-1 h-3 w-3" />
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCancel} className="h-9 text-zinc-500">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function NumberInputField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label className="text-sm text-zinc-400">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= min && v <= max) onChange(v);
          }}
          className="h-8 w-20 text-center text-sm"
        />
        {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Character config status helper ──

function CharacterConfigStatus({ config }: { config: CharacterConfig }) {
  const platforms = [
    { name: "Discord", ok: config.discord.enabled },
    { name: "Telegram", ok: config.telegram.enabled },
    { name: "WhatsApp", ok: config.whatsapp.enabled },
    { name: "Twitter", ok: Boolean(config.twitter.clientId || config.twitter.apiKey) },
    { name: "Voice", ok: config.voice.provider !== "" },
  ];
  const configured = platforms.filter((p) => p.ok).length;
  return (
    <Badge variant="ghost" className="text-xs">
      {configured}/{platforms.length} platforms
    </Badge>
  );
}

// ── Main page (with Suspense boundary for useSearchParams) ──

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [characters, setCharacters] = useState<string[]>([]);
  const [charConfig, setCharConfig] = useState<CharacterConfig>(getDefaultCharacterConfig());
  const [charConfigDraft, setCharConfigDraft] = useState<CharacterConfig>(getDefaultCharacterConfig());
  const [charDirty, setCharDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, string | number | boolean>>({});

  const selectedCharacter = searchParams.get("character") ?? "";

  const setSelectedCharacter = useCallback(
    (name: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (name) {
        params.set("character", name);
      } else {
        params.delete("character");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  // Fetch global settings + character list
  const fetchSettings = useCallback((charName?: string) => {
    const url = charName ? `/api/settings?character=${encodeURIComponent(charName)}` : "/api/settings";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load settings");
        return res.json();
      })
      .then((data) => {
        setSettings(data);
        if (data.characters) {
          setCharacters(data.characters);
          if (!selectedCharacter && data.characters.length > 0) {
            setSelectedCharacter(data.characters[0]);
          }
        }
        if (data.characterConfig) {
          setCharConfig(data.characterConfig);
          setCharConfigDraft(data.characterConfig);
          setCharDirty(false);
        }
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Initial load
  useEffect(() => {
    fetchSettings(selectedCharacter || undefined);
  }, [fetchSettings, selectedCharacter]);

  const queueChange = useCallback((key: string, value: string | number | boolean) => {
    setPendingChanges((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingChanges),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSettings(data);
      setPendingChanges({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [pendingChanges]);

  // Quick save for individual key fields
  const handleKeyChange = useCallback(async (envKey: string, value: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [envKey]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSettings(data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Character config helpers ──

  const updateCharDraft = useCallback(
    <S extends keyof CharacterConfig>(
      section: S,
      field: keyof CharacterConfig[S],
      value: CharacterConfig[S][typeof field],
    ) => {
      setCharConfigDraft((prev) => ({
        ...prev,
        [section]: { ...prev[section], [field]: value },
      }));
      setCharDirty(true);
      setSaveSuccess(false);
      setSaveError(null);
    },
    [],
  );

  const handleSaveCharConfig = useCallback(async () => {
    if (!selectedCharacter || !charDirty) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: selectedCharacter,
          characterConfig: charConfigDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save character config");
      if (data.characterConfig) {
        setCharConfig(data.characterConfig);
        setCharConfigDraft(data.characterConfig);
      }
      setCharDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [selectedCharacter, charDirty, charConfigDraft]);

  // Quick save for character key fields (masked fields that save immediately)
  const handleCharKeyChange = useCallback(
    async (section: keyof CharacterConfig, field: string, value: string) => {
      if (!selectedCharacter) return;
      setSaving(true);
      setSaveError(null);

      const partialConfig = { [section]: { [field]: value } };

      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character: selectedCharacter,
            characterConfig: partialConfig,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save");
        if (data.characterConfig) {
          setCharConfig(data.characterConfig);
          setCharConfigDraft(data.characterConfig);
          setCharDirty(false);
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [selectedCharacter],
  );

  const handleSaveEverything = useCallback(async () => {
    const _hasPending = Object.keys(pendingChanges).length > 0;
    if (_hasPending) await handleSaveAll();
    if (charDirty) await handleSaveCharConfig();
  }, [pendingChanges, charDirty, handleSaveAll, handleSaveCharConfig]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <p className="text-lg font-medium text-red-400">Configuration Error</p>
          <p className="mt-2 text-sm text-zinc-400">{error}</p>
          <p className="mt-4 text-sm text-zinc-500">
            Run <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">npx opencrush@latest setup</code> to create your .env file.
          </p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const hasPending = Object.keys(pendingChanges).length > 0;
  const hasAnyPending = hasPending || charDirty;
  const pendingCount = Object.keys(pendingChanges).length + (charDirty ? 1 : 0);

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Configure your Opencrush companion
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            {saveError && (
              <span className="flex items-center gap-1.5 text-sm text-red-400">
                <AlertCircle className="h-4 w-4" /> {saveError}
              </span>
            )}
            <Button
              onClick={handleSaveEverything}
              disabled={!hasAnyPending || saving}
              className={hasAnyPending ? "crush-glow" : ""}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {hasAnyPending ? `Save ${pendingCount} Changes` : "All Saved"}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {/* ── AI Provider ── */}
          <Collapsible
            title="AI Provider"
            icon={<Bot className="h-4 w-4" />}
            defaultOpen
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-zinc-400">LLM Provider</label>
                <Select
                  value={pendingChanges.LLM_PROVIDER as string ?? settings.llmProvider}
                  onChange={(e) => queueChange("LLM_PROVIDER", e.target.value)}
                  options={LLM_PROVIDERS}
                  className="w-56"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-zinc-400">Model Override</label>
                <Input
                  value={pendingChanges.LLM_MODEL as string ?? settings.llmModel}
                  onChange={(e) => queueChange("LLM_MODEL", e.target.value)}
                  placeholder="(provider default)"
                  className="w-56 text-sm"
                />
              </div>
            </div>
          </Collapsible>

          {/* ── Character Selector ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex items-center gap-3">
              <Users className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-semibold text-zinc-100">Character</h3>
              <select
                value={selectedCharacter}
                onChange={(e) => setSelectedCharacter(e.target.value)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-sm text-zinc-200 outline-none transition-colors hover:border-zinc-600 focus:border-primary"
              >
                {characters.map((name) => (
                  <option key={name} value={name}>
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
              {selectedCharacter && (
                <CharacterConfigStatus config={charConfigDraft} />
              )}
            </div>
          </div>

          {/* ── API Keys ── */}
          <Collapsible
            title="API Keys"
            icon={<Key className="h-4 w-4" />}
            badge={
              <Badge variant="ghost" className="text-xs">
                {Object.values(settings.keys).filter(Boolean).length} configured
              </Badge>
            }
          >
            <div className="space-y-1">
              <MaskedKeyField
                label="Anthropic"
                envKey="ANTHROPIC_API_KEY"
                value={settings.keys.ANTHROPIC_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="OpenAI"
                envKey="OPENAI_API_KEY"
                value={settings.keys.OPENAI_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="xAI"
                envKey="XAI_API_KEY"
                value={settings.keys.XAI_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="DeepSeek"
                envKey="DEEPSEEK_API_KEY"
                value={settings.keys.DEEPSEEK_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="Qwen"
                envKey="DASHSCOPE_API_KEY"
                value={settings.keys.DASHSCOPE_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="Kimi"
                envKey="MOONSHOT_API_KEY"
                value={settings.keys.MOONSHOT_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="Zhipu (China)"
                envKey="ZHIPU_API_KEY"
                value={settings.keys.ZHIPU_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="MiniMax (China)"
                envKey="MINIMAX_API_KEY"
                value={settings.keys.MINIMAX_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="MiniMax (Global)"
                envKey="MINIMAX_GLOBAL_API_KEY"
                value={settings.keys.MINIMAX_GLOBAL_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              <MaskedKeyField
                label="Z.ai (Global)"
                envKey="ZAI_API_KEY"
                value={settings.keys.ZAI_API_KEY ?? ""}
                onChange={handleKeyChange}
              />
              {/* Google Gemini: hidden until backend is implemented */}

              <div className="border-t border-zinc-800/50 mt-2 pt-2" />
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Ollama (Local)</p>
              <div className="flex items-center justify-between gap-3 py-2">
                <label className="text-sm text-zinc-400">Base URL</label>
                <Input
                  value={pendingChanges.OLLAMA_BASE_URL as string ?? settings.keys.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"}
                  onChange={(e) => queueChange("OLLAMA_BASE_URL", e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="w-56 text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <label className="text-sm text-zinc-400">Model</label>
                <Input
                  value={pendingChanges.OLLAMA_MODEL as string ?? settings.keys.OLLAMA_MODEL ?? "qwen2.5:7b"}
                  onChange={(e) => queueChange("OLLAMA_MODEL", e.target.value)}
                  placeholder="qwen2.5:7b"
                  className="w-56 text-sm"
                />
              </div>
            </div>
          </Collapsible>

          {/* Per-character sections are rendered after Features, below */}

          {/* ── Features ── */}
          <Collapsible
            title="Features"
            icon={<Zap className="h-4 w-4" />}
            defaultOpen
          >
            <div className="space-y-5">
              {/* Selfies / Image Generation */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-zinc-400" />
                    <div>
                      <p className="text-sm text-zinc-300">Selfies / Image Generation</p>
                      <p className="text-xs text-zinc-500">Generate images with FAL AI</p>
                    </div>
                  </div>
                  <StatusDot active={settings.imageGeneration.enabled} />
                </div>
                <div className="pl-6 space-y-1">
                  <MaskedKeyField
                    label="FAL Key"
                    envKey="FAL_KEY"
                    value={settings.imageGeneration.falKey}
                    onChange={handleKeyChange}
                  />
                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-zinc-400">Image Model</label>
                    <Input
                      value={pendingChanges.IMAGE_MODEL as string ?? settings.imageGeneration.model}
                      onChange={(e) => queueChange("IMAGE_MODEL", e.target.value)}
                      placeholder="fal-ai/flux-realism"
                      className="w-56 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-800/50" />

              {/* Voice */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-zinc-400" />
                    <div>
                      <p className="text-sm text-zinc-300">Voice</p>
                      <p className="text-xs text-zinc-500">TTS and voice conversation</p>
                    </div>
                  </div>
                  <StatusDot active={settings.voice.enabled} />
                </div>
                <div className="pl-6 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-zinc-400">TTS Provider</label>
                    <Select
                      value={pendingChanges.TTS_PROVIDER as string ?? settings.voice.provider}
                      onChange={(e) => queueChange("TTS_PROVIDER", e.target.value)}
                      options={TTS_PROVIDERS}
                      className="w-48"
                    />
                  </div>
                  <MaskedKeyField
                    label="ElevenLabs Key"
                    envKey="ELEVENLABS_API_KEY"
                    value={settings.voice.elevenlabsKey}
                    onChange={handleKeyChange}
                  />
                  <MaskedKeyField
                    label="Fish Audio Key"
                    envKey="FISH_AUDIO_API_KEY"
                    value={settings.voice.fishAudioKey}
                    onChange={handleKeyChange}
                  />
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-zinc-400">Voice Conversation</label>
                    <Switch
                      checked={pendingChanges.VOICE_CONVERSATION_ENABLED !== undefined
                        ? pendingChanges.VOICE_CONVERSATION_ENABLED === "true"
                        : settings.voice.conversationEnabled}
                      onCheckedChange={(v) => queueChange("VOICE_CONVERSATION_ENABLED", v ? "true" : "false")}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-800/50" />

              {/* Browser Automation */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-300">Browser Automation</p>
                    <p className="text-xs text-zinc-500">Allow character to browse the web</p>
                  </div>
                </div>
                <Switch
                  checked={pendingChanges.BROWSER_AUTOMATION_ENABLED !== undefined
                    ? pendingChanges.BROWSER_AUTOMATION_ENABLED === "true"
                    : settings.browserAutomation}
                  onCheckedChange={(v) => queueChange("BROWSER_AUTOMATION_ENABLED", v ? "true" : "false")}
                />
              </div>
            </div>
          </Collapsible>

          {/* ── Per-Character Configuration ── */}
          {selectedCharacter && (
            <>
              <div className="mt-2 mb-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {selectedCharacter.charAt(0).toUpperCase() + selectedCharacter.slice(1)} &mdash; Platform Config
                </p>
              </div>

              {/* ── Discord ── */}
              <Collapsible
                title="Discord"
                icon={<MessageSquare className="h-4 w-4" />}
                badge={<StatusDot active={charConfigDraft.discord.enabled} />}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-zinc-400">Enabled</label>
                    <Switch
                      checked={charConfigDraft.discord.enabled}
                      onCheckedChange={(v) => updateCharDraft("discord", "enabled", v)}
                    />
                  </div>
                  <MaskedKeyField
                    label="Bot Token"
                    envKey="discord.botToken"
                    value={charConfigDraft.discord.botToken}
                    onChange={(_key, value) => handleCharKeyChange("discord", "botToken", value)}
                  />
                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-zinc-400">Client ID</label>
                    <Input
                      value={charConfigDraft.discord.clientId}
                      onChange={(e) => updateCharDraft("discord", "clientId", e.target.value)}
                      placeholder="Discord client ID"
                      className="w-48 text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-zinc-400">Owner ID</label>
                    <Input
                      value={charConfigDraft.discord.ownerId}
                      onChange={(e) => updateCharDraft("discord", "ownerId", e.target.value)}
                      placeholder="Your Discord user ID"
                      className="w-48 text-sm"
                    />
                  </div>
                </div>
              </Collapsible>

              {/* ── Telegram ── */}
              <Collapsible
                title="Telegram"
                icon={<MessageSquare className="h-4 w-4" />}
                badge={<StatusDot active={charConfigDraft.telegram.enabled} />}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-zinc-400">Enabled</label>
                    <Switch
                      checked={charConfigDraft.telegram.enabled}
                      onCheckedChange={(v) => updateCharDraft("telegram", "enabled", v)}
                    />
                  </div>
                  <MaskedKeyField
                    label="Bot Token"
                    envKey="telegram.botToken"
                    value={charConfigDraft.telegram.botToken}
                    onChange={(_key, value) => handleCharKeyChange("telegram", "botToken", value)}
                  />
                  <div className="flex items-center justify-between gap-3 py-2">
                    <label className="text-sm text-zinc-400">Owner ID</label>
                    <Input
                      value={charConfigDraft.telegram.ownerId}
                      onChange={(e) => updateCharDraft("telegram", "ownerId", e.target.value)}
                      placeholder="Telegram user ID"
                      className="w-48 text-sm"
                    />
                  </div>
                </div>
              </Collapsible>

              {/* ── WhatsApp ── */}
              <Collapsible
                title="WhatsApp"
                icon={<Phone className="h-4 w-4" />}
                badge={<StatusDot active={charConfigDraft.whatsapp.enabled} />}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-300">Enabled</p>
                    <p className="text-xs text-zinc-500">QR code pairing</p>
                  </div>
                  <Switch
                    checked={charConfigDraft.whatsapp.enabled}
                    onCheckedChange={(v) => updateCharDraft("whatsapp", "enabled", v)}
                  />
                </div>
              </Collapsible>

              {/* ── Voice ── */}
              <Collapsible
                title="Voice"
                icon={<Mic className="h-4 w-4" />}
                badge={<StatusDot active={charConfigDraft.voice.provider !== ""} />}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-zinc-400">TTS Provider</label>
                    <Select
                      value={charConfigDraft.voice.provider}
                      onChange={(e) =>
                        updateCharDraft(
                          "voice",
                          "provider",
                          e.target.value as "elevenlabs" | "fish_audio" | "",
                        )
                      }
                      options={VOICE_PROVIDERS}
                      className="w-48"
                    />
                  </div>

                  {(charConfigDraft.voice.provider === "elevenlabs" || charConfigDraft.voice.provider === "") && (
                    <>
                      <MaskedKeyField
                        label="ElevenLabs API Key"
                        envKey="voice.elevenlabsKey"
                        value={charConfigDraft.voice.elevenlabsKey}
                        onChange={(_key, value) => handleCharKeyChange("voice", "elevenlabsKey", value)}
                      />
                      <div className="flex items-center justify-between gap-3 py-2">
                        <label className="text-sm text-zinc-400">ElevenLabs Voice ID</label>
                        <Input
                          value={charConfigDraft.voice.elevenlabsVoiceId}
                          onChange={(e) => updateCharDraft("voice", "elevenlabsVoiceId", e.target.value)}
                          placeholder="Voice ID"
                          className="w-48 text-sm"
                        />
                      </div>
                    </>
                  )}

                  {charConfigDraft.voice.provider === "fish_audio" && (
                    <>
                      <MaskedKeyField
                        label="Fish Audio API Key"
                        envKey="voice.fishAudioKey"
                        value={charConfigDraft.voice.fishAudioKey}
                        onChange={(_key, value) => handleCharKeyChange("voice", "fishAudioKey", value)}
                      />
                      <div className="flex items-center justify-between gap-3 py-2">
                        <label className="text-sm text-zinc-400">Fish Audio Voice ID</label>
                        <Input
                          value={charConfigDraft.voice.fishAudioVoiceId}
                          onChange={(e) => updateCharDraft("voice", "fishAudioVoiceId", e.target.value)}
                          placeholder="Voice ID"
                          className="w-48 text-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between">
                    <label className="text-sm text-zinc-400">Voice Conversation</label>
                    <Switch
                      checked={charConfigDraft.voice.conversationEnabled}
                      onCheckedChange={(v) => updateCharDraft("voice", "conversationEnabled", v)}
                    />
                  </div>
                </div>
              </Collapsible>

              {/* ── Twitter / X ── */}
              <Collapsible
                title="Twitter / X"
                icon={<Twitter className="h-4 w-4" />}
                badge={
                  <StatusDot
                    active={Boolean(charConfigDraft.twitter.clientId || charConfigDraft.twitter.apiKey)}
                  />
                }
              >
                <div className="space-y-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-zinc-200">OAuth Status</p>
                        <p className="text-xs text-zinc-500">
                          {charConfigDraft.twitter.clientId || charConfigDraft.twitter.apiKey
                            ? "Twitter API credentials configured"
                            : "No Twitter credentials found"}
                        </p>
                      </div>
                      <a
                        href="https://developer.twitter.com/en/portal/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Developer Portal
                      </a>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3 py-2">
                      <label className="text-sm text-zinc-400">Client ID</label>
                      <Input
                        value={charConfigDraft.twitter.clientId}
                        onChange={(e) => updateCharDraft("twitter", "clientId", e.target.value)}
                        placeholder="Twitter client ID"
                        className="w-48 text-sm"
                      />
                    </div>
                    <MaskedKeyField
                      label="Client Secret"
                      envKey="twitter.clientSecret"
                      value={charConfigDraft.twitter.clientSecret}
                      onChange={(_key, value) => handleCharKeyChange("twitter", "clientSecret", value)}
                    />
                    <MaskedKeyField
                      label="API Key"
                      envKey="twitter.apiKey"
                      value={charConfigDraft.twitter.apiKey}
                      onChange={(_key, value) => handleCharKeyChange("twitter", "apiKey", value)}
                    />
                  </div>

                  <div className="border-t border-zinc-800/50 pt-4" />

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-zinc-300">Auto-posting</p>
                      <p className="text-xs text-zinc-500">Automatically post tweets on a schedule</p>
                    </div>
                    <Switch
                      checked={charConfigDraft.twitter.autoPost}
                      onCheckedChange={(v) => updateCharDraft("twitter", "autoPost", v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-zinc-400">Post Interval</label>
                      <span className="font-mono text-sm text-zinc-300">
                        {charConfigDraft.twitter.postInterval} min
                      </span>
                    </div>
                    <Slider
                      value={charConfigDraft.twitter.postInterval}
                      onValueChange={(v) => updateCharDraft("twitter", "postInterval", v)}
                      min={15}
                      max={720}
                      step={15}
                    />
                    <div className="flex justify-between text-xs text-zinc-600">
                      <span>15 min</span>
                      <span>12 hours</span>
                    </div>
                  </div>
                </div>
              </Collapsible>

              {/* ── Autonomous Behavior ── */}
              <Collapsible
                title="Autonomous Behavior"
                icon={<Clock className="h-4 w-4" />}
              >
                <div className="space-y-5">
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-zinc-300">Quiet Hours</p>
                    <p className="text-xs text-zinc-500">
                      Character won&apos;t send proactive messages during these hours
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-400">Starts at</label>
                        <div className="flex items-center gap-2">
                          <Slider
                            value={charConfigDraft.autonomous.quietHoursStart}
                            onValueChange={(v) => updateCharDraft("autonomous", "quietHoursStart", v)}
                            min={0}
                            max={23}
                            className="w-40"
                          />
                          <span className="w-12 text-right font-mono text-sm text-zinc-300">
                            {charConfigDraft.autonomous.quietHoursStart}:00
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-400">Ends at</label>
                        <div className="flex items-center gap-2">
                          <Slider
                            value={charConfigDraft.autonomous.quietHoursEnd}
                            onValueChange={(v) => updateCharDraft("autonomous", "quietHoursEnd", v)}
                            min={0}
                            max={23}
                            className="w-40"
                          />
                          <span className="w-12 text-right font-mono text-sm text-zinc-300">
                            {charConfigDraft.autonomous.quietHoursEnd}:00
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-800/50" />

                  <div className="space-y-3">
                    <p className="text-sm font-medium text-zinc-300">Proactive Messages</p>
                    <p className="text-xs text-zinc-500">
                      How often the character initiates conversation
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-400">Min interval</label>
                        <div className="flex items-center gap-2">
                          <Slider
                            value={charConfigDraft.autonomous.proactiveMinInterval}
                            onValueChange={(v) => updateCharDraft("autonomous", "proactiveMinInterval", v)}
                            min={5}
                            max={1440}
                            step={5}
                            className="w-40"
                          />
                          <span className="w-16 text-right font-mono text-sm text-zinc-300">
                            {charConfigDraft.autonomous.proactiveMinInterval} min
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-400">Max interval</label>
                        <div className="flex items-center gap-2">
                          <Slider
                            value={charConfigDraft.autonomous.proactiveMaxInterval}
                            onValueChange={(v) => updateCharDraft("autonomous", "proactiveMaxInterval", v)}
                            min={5}
                            max={1440}
                            step={5}
                            className="w-40"
                          />
                          <span className="w-16 text-right font-mono text-sm text-zinc-300">
                            {charConfigDraft.autonomous.proactiveMaxInterval} min
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Collapsible>
            </>
          )}

          {/* ── Quick Actions ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-100">Quick Actions</h3>
            <div className="space-y-2 text-sm text-zinc-400">
              <p>
                Re-run setup:{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                  npx opencrush@latest setup
                </code>
              </p>
              <p>
                Start companion:{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                  npx opencrush@latest start
                </code>
              </p>
              <p>
                New character:{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                  npx opencrush@latest create
                </code>
              </p>
            </div>
          </div>
        </div>

        {/* Sticky save bar when there are pending changes */}
        {hasAnyPending && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
            <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
              <p className="text-sm text-zinc-400">
                {pendingCount} unsaved change{pendingCount > 1 ? "s" : ""}
                {charDirty && selectedCharacter
                  ? ` (${selectedCharacter})`
                  : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingChanges({});
                    if (charDirty) {
                      setCharConfigDraft(charConfig);
                      setCharDirty(false);
                    }
                  }}
                  className="text-zinc-500"
                >
                  Discard
                </Button>
                <Button size="sm" onClick={handleSaveEverything} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-3 w-3" />
                  )}
                  Save All
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
