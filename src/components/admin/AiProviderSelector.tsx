"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  List,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PROVIDER_INFO, getModelsForProvider } from "@/lib/constants";
import type { ProviderInfo } from "@/lib/constants";
import type { AiProvider, AdminSettingsUpdateInput, AdminSettingsView } from "@/lib/types";
import { FieldLabel, SaveStatus, SettingsCard, inputClass, useSaveStatus } from "./shared";

/**
 * AI sağlayıcı yönetimi: dropdown ile sağlayıcı seçimi (8 sağlayıcı),
 * maskeli API key girişleri, sağlayıcıya göre dinamik model listesi ve
 * Local AI (Custom) için Base URL + opsiyonel key + serbest model adı.
 */
export function AiProviderSelector({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [provider, setProvider] = useState<AiProvider>(settings.aiProvider);
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel);
  const [openaiModel, setOpenaiModel] = useState(settings.openaiModel);
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropicModel);
  const [deepseekModel, setDeepseekModel] = useState(settings.deepseekModel);
  const [grokModel, setGrokModel] = useState(settings.grokModel);
  const [mistralModel, setMistralModel] = useState(settings.mistralModel);
  const [nvidiaModel, setNvidiaModel] = useState(settings.nvidiaModel);
  const [customBaseUrl, setCustomBaseUrl] = useState(settings.customBaseUrl ?? "");
  const [customModel, setCustomModel] = useState(settings.customModel);
  // Local AI model listesi — /api/admin/list-models ile çekilir. Sayfa açılışında
  // otomatik çekim yapılmaz; ağ çağrısı bilinçli "Modelleri Getir" basışıyla yapılır.
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [modelFetchSuccess, setModelFetchSuccess] = useState<string | null>(null);
  /** true → serbest metin girişi; false → çekilen listeden seçim (dropdown). */
  const [manualModelInput, setManualModelInput] = useState(false);
  const [testState, setTestState] = useState<{
    kind: "idle" | "testing" | "success" | "error";
    message?: string;
  }>({ kind: "idle" });

  const providerMeta: ProviderInfo = PROVIDER_INFO.find((p) => p.id === provider) ?? {
    id: provider,
    label: provider,
    description: "",
    isLocal: false,
    baseUrlPlaceholder: null,
  };
  const isCustom = provider === "CUSTOM";
  const models = getModelsForProvider(provider);

  /** Sağlayıcıya göre aktif model değerini döndürür. */
  function getActiveModel(p: AiProvider): string {
    switch (p) {
      case "GEMINI":
        return geminiModel;
      case "OPENAI":
        return openaiModel;
      case "ANTHROPIC":
        return anthropicModel;
      case "DEEPSEEK":
        return deepseekModel;
      case "GROK":
        return grokModel;
      case "MISTRAL":
        return mistralModel;
      case "NVIDIA":
        return nvidiaModel;
      case "CUSTOM":
        return customModel;
      default: {
        const exhaustive: never = p;
        return String(exhaustive);
      }
    }
  }

  /** Sağlayıcıya göre model state setter'ını çağırır. */
  function setModelFor(p: AiProvider, value: string): void {
    switch (p) {
      case "GEMINI":
        setGeminiModel(value);
        break;
      case "OPENAI":
        setOpenaiModel(value);
        break;
      case "ANTHROPIC":
        setAnthropicModel(value);
        break;
      case "DEEPSEEK":
        setDeepseekModel(value);
        break;
      case "GROK":
        setGrokModel(value);
        break;
      case "MISTRAL":
        setMistralModel(value);
        break;
      case "NVIDIA":
        setNvidiaModel(value);
        break;
      case "CUSTOM":
        setCustomModel(value);
        break;
      default: {
        const exhaustive: never = p;
        void exhaustive;
      }
    }
  }

  /** Sağlayıcıya göre model alan adını döndürür (AdminSettingsUpdateInput). */
  function modelFieldFor(p: AiProvider): "geminiModel" | "openaiModel" | "anthropicModel" | "deepseekModel" | "grokModel" | "mistralModel" | "nvidiaModel" | "customModel" {
    switch (p) {
      case "GEMINI":
        return "geminiModel";
      case "OPENAI":
        return "openaiModel";
      case "ANTHROPIC":
        return "anthropicModel";
      case "DEEPSEEK":
        return "deepseekModel";
      case "GROK":
        return "grokModel";
      case "MISTRAL":
        return "mistralModel";
      case "NVIDIA":
        return "nvidiaModel";
      case "CUSTOM":
        return "customModel";
      default: {
        const exhaustive: never = p;
        return "geminiModel" as never satisfies typeof exhaustive;
      }
    }
  }

  /** Sağlayıcıya göre maskeli key görünüm alanını döndürür. */
  function maskedFieldFor(p: AiProvider): keyof AdminSettingsView | null {
    switch (p) {
      case "GEMINI":
        return "geminiApiKeyMasked";
      case "OPENAI":
        return "openaiApiKeyMasked";
      case "ANTHROPIC":
        return "anthropicApiKeyMasked";
      case "DEEPSEEK":
        return "deepseekApiKeyMasked";
      case "GROK":
        return "grokApiKeyMasked";
      case "MISTRAL":
        return "mistralApiKeyMasked";
      case "NVIDIA":
        return "nvidiaApiKeyMasked";
      case "CUSTOM":
        return "customApiKeyMasked";
      default: {
        const exhaustive: never = p;
        return null as never satisfies typeof exhaustive;
      }
    }
  }

  async function handleProviderChange(next: AiProvider) {
    setProvider(next);
    const result = await run({ aiProvider: next });
    if (result) {
      onSaved({ ...settings, aiProvider: next });
    }
  }

  async function handleModelChange(value: string) {
    setModelFor(provider, value);
    const update: AdminSettingsUpdateInput = { [modelFieldFor(provider)]: value };
    const result = await run(update);
    if (result) {
      onSaved({ ...settings, ...update } as AdminSettingsView);
    }
  }

  /** CUSTOM model adı (serbest metin) kaydı — blur'da otomatik kaydeder. */
  async function handleCustomModelBlur() {
    const value = customModel.trim();
    if (!value || value === settings.customModel) return;
    const result = await run({ customModel: value });
    if (result) {
      onSaved({ ...settings, customModel: value });
    }
  }

  /** CUSTOM Base URL kaydı — blur'da otomatik kaydeder. */
  async function handleCustomBaseUrlBlur() {
    const value = customBaseUrl.trim();
    if (value === (settings.customBaseUrl ?? "")) return;
    if (value && !/^https?:\/\/.+/i.test(value)) return; // validator hata mesajı run'dan gelir; geçersizse kaydetme
    const update: AdminSettingsUpdateInput = { customBaseUrl: value };
    const result = await run(update);
    if (result) {
      onSaved({ ...settings, customBaseUrl: value || null });
    }
  }

  /**
   * Local AI sunucusundan kurulu model listesini çeker — POST /api/admin/list-models.
   * Girili Base URL + (varsa) girili key ile çağrılır; liste dropdown'a dolar.
   * Mevcut customModel listede varsa seçili kalır; boşsa ilk model seçilir.
   */
  async function handleFetchModels(): Promise<void> {
    const baseUrlTrimmed = customBaseUrl.trim();
    if (!baseUrlTrimmed) {
      setModelFetchError("Önce Base URL girin (örn. http://localhost:11434/v1).");
      setModelFetchSuccess(null);
      return;
    }
    setFetchingModels(true);
    setModelFetchError(null);
    setModelFetchSuccess(null);
    try {
      const response = await fetch("/api/admin/list-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrlTrimmed,
          ...(customKey.trim() ? { apiKey: customKey.trim() } : {}),
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `Model listesi alınamadı (HTTP ${response.status}).`;
        setModelFetchError(message);
        return;
      }
      const models: string[] = [];
      if (
        typeof data === "object" &&
        data !== null &&
        Array.isArray((data as { models: unknown }).models)
      ) {
        for (const m of (data as { models: unknown[] }).models) {
          if (typeof m === "string" && m.length > 0) models.push(m);
        }
      }
      setModelList(models);
      setManualModelInput(false);
      if (models.length === 0) {
        setModelFetchError(
          "Sunucu model döndürmedi — kurulu model yok mu? (örn. Ollama: ollama pull llama3.2)",
        );
        return;
      }
      setModelFetchSuccess(`${models.length} model bulundu — listeden seçin.`);
      // Mevcut model listede varsa seçili kalır; boşsa ilk model otomatik seçilir.
      if (!customModel.trim()) {
        await handleModelChange(models[0] ?? "");
      }
    } catch {
      setModelFetchError(
        "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
      );
    } finally {
      setFetchingModels(false);
    }
  }

  /** Key kaydetme — hangi sağlayıcı olduğu alan adıyla çözülür. */
  async function handleSaveKey(which: AiProvider, key: string, clearInput: () => void) {
    const trimmed = key.trim();
    if (!trimmed) return;
    const finalUpdate: AdminSettingsUpdateInput =
      which === "GEMINI"
        ? { geminiApiKey: trimmed }
        : which === "OPENAI"
          ? { openaiApiKey: trimmed }
          : which === "ANTHROPIC"
            ? { anthropicApiKey: trimmed }
            : which === "DEEPSEEK"
              ? { deepseekApiKey: trimmed }
              : which === "GROK"
                ? { grokApiKey: trimmed }
                : which === "MISTRAL"
                  ? { mistralApiKey: trimmed }
                  : which === "NVIDIA"
                    ? { nvidiaApiKey: trimmed }
                    : { customApiKey: trimmed };
    const result = await run(finalUpdate);
    if (result) {
      const maskedField = maskedFieldFor(which);
      if (maskedField) {
        onSaved({
          ...settings,
          [maskedField]: `••••••••${trimmed.slice(-4)}`,
        } as AdminSettingsView);
      }
      clearInput();
    }
  }

  /** Key temizleme — hangi sağlayıcı olduğu maskedField ile çözülür. */
  async function handleClearKey(which: AiProvider) {
    const finalUpdate: AdminSettingsUpdateInput =
      which === "GEMINI"
        ? { geminiApiKey: "" }
        : which === "OPENAI"
          ? { openaiApiKey: "" }
          : which === "ANTHROPIC"
            ? { anthropicApiKey: "" }
            : which === "DEEPSEEK"
              ? { deepseekApiKey: "" }
              : which === "GROK"
                ? { grokApiKey: "" }
                : which === "MISTRAL"
                  ? { mistralApiKey: "" }
                  : which === "NVIDIA"
                    ? { nvidiaApiKey: "" }
                    : { customApiKey: "" };
    const result = await run(finalUpdate);
    if (result) {
      const maskedField = maskedFieldFor(which);
      if (maskedField) {
        onSaved({ ...settings, [maskedField]: "" } as AdminSettingsView);
      }
    }
  }

  /** Aktif sağlayıcının bağlantısını test eder — POST /api/admin/test-ai. */
  async function handleTestConnection() {
    setTestState({ kind: "testing" });
    try {
      const response = await fetch("/api/admin/test-ai", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "message" in payload &&
        typeof (payload as { message: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `İstek başarısız (HTTP ${response.status}).`;
      const ok =
        typeof payload === "object" &&
        payload !== null &&
        "ok" in payload &&
        (payload as { ok: unknown }).ok === true;
      setTestState({ kind: ok ? "success" : "error", message });
    } catch (error: unknown) {
      setTestState({
        kind: "error",
        message: error instanceof Error ? error.message : "Ağ hatası.",
      });
    }
  }

  return (
    <SettingsCard
      title="AI Sağlayıcı Yönetimi"
      description="Analiz motorunun kullanacağı yapay zeka sağlayıcısını, API anahtarını ve modeli yapılandırın. Local AI (Ollama, LM Studio vb.) desteği dahildir."
      icon={<Sparkles className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-6">
        {/* Sağlayıcı seçimi — dropdown liste */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-200">Aktif Sağlayıcı</legend>
          <select
            aria-label="Aktif AI sağlayıcı"
            value={provider}
            onChange={(e) => {
              const next = PROVIDER_INFO.find((p) => p.id === e.target.value)?.id;
              if (next) void handleProviderChange(next);
            }}
            className={`${inputClass} mt-1.5`}
          >
            {PROVIDER_INFO.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.description}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-gray-500">
            {providerMeta.description}
            {providerMeta.isLocal ? " API anahtarı genellikle gerekmez; Base URL ve model adı yeterlidir." : ""}
          </p>
        </fieldset>

        {/* CUSTOM (Local AI) — Base URL → opsiyonel Local API Key → sunucudan model listesi */}
        {isCustom ? (
          <div className="space-y-4 rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium text-blue-200">
              <Sparkles className="h-4 w-4 text-blue-400" aria-hidden />
              Local AI Yapılandırması
            </p>
            <div>
              <FieldLabel
                htmlFor="custom-base-url"
                label="Base URL (zorunlu)"
                hint="OpenAI-uyumlu sunucu adresi — Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1"
              />
              <input
                id="custom-base-url"
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                onBlur={() => void handleCustomBaseUrlBlur()}
                placeholder={providerMeta.baseUrlPlaceholder ?? "http://localhost:11434/v1"}
                autoComplete="off"
                className={`${inputClass} mt-1.5`}
              />
            </div>

            {/* Local API Key — opsiyonel; Ollama gibi sunucular key istemez. */}
            <KeyCard
              which="CUSTOM"
              title="Local AI API Key (opsiyonel)"
              placeholder="Boş bırakılabilir — Ollama key istemez"
              accent="text-blue-400"
              value={customKey}
              onChange={setCustomKey}
              helperText="Bazı sunucular (LM Studio, llama.cpp server, vLLM) Bearer key isteyebilir; Ollama genellikle istemez."
              maskedValue={settings.customApiKeyMasked}
              showKeys={showKeys}
              onToggleShowKeys={() => setShowKeys((v) => !v)}
              onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
              onClear={(w) => void handleClearKey(w)}
            />

            {/* Model — "Modelleri Getir" ile sunucudan liste çekilir; dropdown veya serbest metin. */}
            <div>
              <FieldLabel
                htmlFor={manualModelInput || modelList.length === 0 ? "custom-model" : "custom-model-select"}
                label="Model (zorunlu)"
                hint="Sunucudan model listesini çekip listeden seçin — veya elle girin."
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {manualModelInput || modelList.length === 0 ? (
                  <input
                    id="custom-model"
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    onBlur={() => void handleCustomModelBlur()}
                    placeholder="llama3.2, qwen2.5, mistral-7b-instruct vb."
                    autoComplete="off"
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                ) : (
                  <select
                    id="custom-model-select"
                    value={customModel}
                    onChange={(e) => void handleModelChange(e.target.value)}
                    className={`${inputClass} min-w-0 flex-1`}
                  >
                    {customModel && !modelList.includes(customModel) ? (
                      <option value={customModel}>{customModel} (kayıtlı)</option>
                    ) : null}
                    {modelList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => void handleFetchModels()}
                  disabled={fetchingModels}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fetchingModels ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {fetchingModels ? "Getiriliyor…" : "Modelleri Getir"}
                </button>
                {modelList.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setManualModelInput((v) => !v)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
                  >
                    {manualModelInput ? (
                      <>
                        <List className="h-3.5 w-3.5" aria-hidden />
                        Listeden Seç
                      </>
                    ) : (
                      <>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Elle Gir
                      </>
                    )}
                  </button>
                ) : null}
              </div>
              {modelFetchError ? (
                <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-rose-300">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {modelFetchError}
                </p>
              ) : null}
              {modelFetchSuccess ? (
                <p role="status" className="mt-2 flex items-start gap-1.5 text-xs text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {modelFetchSuccess}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Model seçimi — bulut sağlayıcılarda dinamik liste; CUSTOM'da yukarıda serbest metin */}
        {!isCustom ? (
          <div>
            <FieldLabel
              htmlFor="ai-model"
              label="Model"
              hint="Analiz kalitesi ve maliyet arasında dengeyi belirler."
            />
            <select
              id="ai-model"
              value={getActiveModel(provider)}
              onChange={(e) => handleModelChange(e.target.value)}
              className={`${inputClass} mt-1.5`}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Bağlantı testi — aktif sağlayıcı + model + key kombinasyonu. */}
        <div className="rounded-lg border border-gray-700 bg-gray-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <FlaskConical className="h-4 w-4 text-blue-400" aria-hidden />
                Bağlantı Testi
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Aktif sağlayıcı ({providerMeta.label} ·{" "}
                {isCustom ? `${customModel || "model girilmedi"} @ ${customBaseUrl || "base URL girilmedi"}` : getActiveModel(provider)}) ile kısa bir ping promptu gönderir.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={testState.kind === "testing"}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testState.kind === "testing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              )}
              {testState.kind === "testing" ? "Test Ediliyor…" : "Test Et"}
            </button>
          </div>
          {testState.kind !== "idle" && testState.kind !== "testing" && (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                testState.kind === "success"
                  ? "bg-emerald-950/60 text-emerald-300"
                  : "bg-red-950/60 text-red-300"
              }`}
            >
              {testState.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>{testState.message}</span>
            </div>
          )}
        </div>

        {/* API anahtarları — aktif sağlayıcıya göre ilgili kart(lar) gösterilir */}
        {provider === "GEMINI" ? (
          <KeyCard
            which="GEMINI"
            title="Google Gemini API Key"
            placeholder="AIza…"
            accent="text-blue-400"
            value={geminiKey}
            onChange={setGeminiKey}
            maskedValue={settings.geminiApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "OPENAI" ? (
          <KeyCard
            which="OPENAI"
            title="OpenAI API Key"
            placeholder="sk-…"
            accent="text-emerald-400"
            value={openaiKey}
            onChange={setOpenaiKey}
            maskedValue={settings.openaiApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "ANTHROPIC" ? (
          <KeyCard
            which="ANTHROPIC"
            title="Anthropic API Key"
            placeholder="sk-ant-…"
            accent="text-orange-400"
            value={anthropicKey}
            onChange={setAnthropicKey}
            maskedValue={settings.anthropicApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "DEEPSEEK" ? (
          <KeyCard
            which="DEEPSEEK"
            title="DeepSeek API Key"
            placeholder="sk-…"
            accent="text-indigo-400"
            value={deepseekKey}
            onChange={setDeepseekKey}
            maskedValue={settings.deepseekApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "GROK" ? (
          <KeyCard
            which="GROK"
            title="xAI Grok API Key"
            placeholder="xai-…"
            accent="text-gray-300"
            value={grokKey}
            onChange={setGrokKey}
            maskedValue={settings.grokApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "MISTRAL" ? (
          <KeyCard
            which="MISTRAL"
            title="Mistral API Key"
            placeholder="…"
            accent="text-yellow-400"
            value={mistralKey}
            onChange={setMistralKey}
            maskedValue={settings.mistralApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        {provider === "NVIDIA" ? (
          <KeyCard
            which="NVIDIA"
            title="NVIDIA NIM API Key"
            placeholder="nvapi-…"
            accent="text-lime-400"
            value={nvidiaKey}
            onChange={setNvidiaKey}
            helperText="Alternatif: .env dosyasına NVIDIA_API_KEY tanımlarsanız buraya key girmeniz gerekmez. İsteklerde otomatik olarak reasoning_effort=max gönderilir."
            maskedValue={settings.nvidiaApiKeyMasked}
            showKeys={showKeys}
            onToggleShowKeys={() => setShowKeys((v) => !v)}
            onSave={(w, v, clearInput) => void handleSaveKey(w, v, clearInput)}
            onClear={(w) => void handleClearKey(w)}
          />
        ) : null}
        <SaveStatus state={state} />
      </div>
    </SettingsCard>
  );
}

/** Key giriş kartı — tüm sağlayıcılar için ortak, modül-seviyesi bileşen. */
function KeyCard({
  which,
  title,
  placeholder,
  accent,
  value,
  onChange,
  helperText,
  maskedValue,
  showKeys,
  onToggleShowKeys,
  onSave,
  onClear,
}: {
  which: AiProvider;
  title: string;
  placeholder: string;
  accent: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  maskedValue: string;
  showKeys: boolean;
  onToggleShowKeys: () => void;
  onSave: (which: AiProvider, value: string, clearInput: () => void) => void;
  onClear: (which: AiProvider) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-950/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className={`h-4 w-4 ${accent}`} aria-hidden />
        {title}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Kayıtlı: {maskedValue || "yok"}
      </p>
      {helperText ? <p className="mt-0.5 text-xs text-gray-600">{helperText}</p> : null}
      <div className="mt-2 flex gap-2">
        <input
          type={showKeys ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={inputClass}
          aria-label={`Yeni ${title}`}
        />
        <button
          type="button"
          onClick={onToggleShowKeys}
          className="rounded-lg border border-gray-700 px-2.5 text-gray-400 hover:text-gray-200"
          aria-label={showKeys ? "Anahtarı gizle" : "Anahtarı göster"}
        >
          {showKeys ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => onSave(which, value, () => onChange(""))}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Kaydet
        </button>
        {maskedValue ? (
          <button
            type="button"
            onClick={() => onClear(which)}
            className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/40"
          >
            Temizle
          </button>
        ) : null}
      </div>
    </div>
  );
}
