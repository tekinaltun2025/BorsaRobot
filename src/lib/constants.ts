import type { AiProvider, NewsSourceId } from "@/lib/types";

/**
 * Platform sabitleri — admin paneli formları ve seed tarafından kullanılır.
 * Bu dosya ne client ne server'a özeldir; ikisi de import edebilir.
 */

/** Google Gemini — admin panelinde seçilebilir modeller. */
export const GEMINI_MODELS = [
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (hızlı, ekonomik)" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (en ekonomik)" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro (en yetenekli)" },
] as const;

/** OpenAI — admin panelinde seçilebilir modeller. */
export const OPENAI_MODELS = [
  { id: "gpt-4o", label: "GPT-4o (dengeli, önerilen)" },
  { id: "gpt-4o-mini", label: "GPT-4o mini (hızlı, ekonomik)" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
] as const;

/** Anthropic Claude — admin panelinde seçilebilir modeller. */
export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (dengeli, önerilen)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (hızlı, ekonomik)" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1 (en yetenekli)" },
] as const;

/** DeepSeek — admin panelinde seçilebilir modeller. */
export const DEEPSEEK_MODELS = [
  { id: "deepseek-chat", label: "DeepSeek Chat (V3 — hızlı, ekonomik)" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1 — derin akıl yürütme)" },
] as const;

/** xAI Grok — admin panelinde seçilebilir modeller. */
export const GROK_MODELS = [
  { id: "grok-4", label: "Grok 4 (en yetenekli)" },
  { id: "grok-3", label: "Grok 3 (dengeli)" },
  { id: "grok-3-mini", label: "Grok 3 mini (hızlı, ekonomik)" },
] as const;

/** Mistral — admin panelinde seçilebilir modeller. */
export const MISTRAL_MODELS = [
  { id: "mistral-large-latest", label: "Mistral Large (en yetenekli)" },
  { id: "mistral-small-latest", label: "Mistral Small (hızlı, ekonomik)" },
  { id: "open-mistral-nemo", label: "Mistral NeMo (dengeli)" },
] as const;

/** NVIDIA NIM — admin panelinde seçilebilir modeller. */
export const NVIDIA_MODELS = [
  { id: "moonshotai/kimi-k3", label: "Kimi K3 (Moonshot — derin akıl yürütme, önerilen)" },
  { id: "deepseek-ai/deepseek-r1", label: "DeepSeek R1 (NVIDIA NIM)" },
  { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B (Meta — NIM)" },
  { id: "qwen/qwen2.5-7b-instruct", label: "Qwen 2.5 7B (NIM)" },
] as const;

/**
 * Local AI (CUSTOM) — model listesi boştur: kullanıcı serbest metinle
 * model adı girer (örn. llama3.2, qwen2.5, mistral-7b-instruct).
 */
export const CUSTOM_MODELS: { id: string; label: string }[] = [];

/** OpenAI-uyumlu sağlayıcıların varsayılan base URL'leri — factory kullanır. */
export const DEFAULT_BASE_URLS = {
  DEEPSEEK: "https://api.deepseek.com",
  GROK: "https://api.x.ai/v1",
  MISTRAL: "https://api.mistral.ai/v1",
  NVIDIA: "https://integrate.api.nvidia.com/v1",
} as const;

/** Sağlayıcı meta bilgisi — UI dropdown ve yardımcı metinler için. */
export interface ProviderInfo {
  id: AiProvider;
  /** Okunabilir ad (örn. "Google Gemini"). */
  label: string;
  /** Kısa açıklama — dropdown seçeneği altında gösterilir. */
  description: string;
  /** Local (kendi sunucumuzda çalışan) AI mı? */
  isLocal: boolean;
  /** CUSTOM için placeholder önerisi; diğerlerinde null. */
  baseUrlPlaceholder: string | null;
}

/** Tüm desteklenen sağlayıcılar — UI dropdown sırası. */
export const PROVIDER_INFO: ProviderInfo[] = [
  {
    id: "GEMINI",
    label: "Google Gemini",
    description: "Gemini API — ücretsiz kota ile başlangıç için ideal.",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "OPENAI",
    label: "OpenAI",
    description: "GPT-4o ailesi — yapılandırılmış JSON çıktı desteği.",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "ANTHROPIC",
    label: "Anthropic Claude",
    description: "Claude ailesi — uzun bağlam ve kaliteli akıl yürütme.",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "DEEPSEEK",
    label: "DeepSeek",
    description: "DeepSeek V3/R1 — ekonomik bulut API (OpenAI-uyumlu).",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "GROK",
    label: "xAI Grok",
    description: "Grok ailesi — xAI bulut API (OpenAI-uyumlu).",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "MISTRAL",
    label: "Mistral AI",
    description: "Mistral Large/Small — Avrupa merkezli bulut API (OpenAI-uyumlu).",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "NVIDIA",
    label: "NVIDIA NIM (Kimi K3)",
    description: "NVIDIA NIM API — Kimi K3 ve diğer modeller (OpenAI-uyumlu, reasoning_effort destekli).",
    isLocal: false,
    baseUrlPlaceholder: null,
  },
  {
    id: "CUSTOM",
    label: "Local AI (Custom)",
    description: "Ollama, LM Studio, vLLM vb. — kendi bilgisayarınızda çalışan OpenAI-uyumlu sunucu.",
    isLocal: true,
    baseUrlPlaceholder: "http://localhost:11434/v1 (Ollama) veya http://localhost:1234/v1 (LM Studio)",
  },
];

/** Sağlayıcıya göre model listesini döndürür — CUSTOM boş liste döner (serbest metin). */
export function getModelsForProvider(provider: AiProvider): { id: string; label: string }[] {
  switch (provider) {
    case "GEMINI":
      return [...GEMINI_MODELS];
    case "OPENAI":
      return [...OPENAI_MODELS];
    case "ANTHROPIC":
      return [...ANTHROPIC_MODELS];
    case "DEEPSEEK":
      return [...DEEPSEEK_MODELS];
    case "GROK":
      return [...GROK_MODELS];
    case "MISTRAL":
      return [...MISTRAL_MODELS];
    case "NVIDIA":
      return [...NVIDIA_MODELS];
    case "CUSTOM":
      return [...CUSTOM_MODELS];
    default: {
      const exhaustive: never = provider;
      return [];
    }
  }
}

/** Haber kaynakları — admin panelinde çoklu seçim listesi. */
export const NEWS_SOURCES: { id: NewsSourceId; label: string; description: string }[] = [
  {
    id: "GOOGLE_NEWS",
    label: "Google News",
    description: "Google Haberler RSS/arama üzerinden sembol bazlı tarama (varsayılan)",
  },
  {
    id: "BIGPARA",
    label: "BigPara",
    description: "BigPara finans içeriklerinden haber çekme",
  },
  {
    id: "CUSTOM_RSS",
    label: "Özel RSS",
    description: "Yönetici tarafından tanımlanan özel RSS akışları",
  },
];

/** Varsayılan sistem promptu — hisse analiz kararları için. */
export const DEFAULT_SYSTEM_PROMPT = `Sen Borsa İstanbul hisselerini takip eden deneyimli bir finansal analistsin. Sana verilen hisse sembolü, son haberler, fiyat geçmişi ve mevcut pozisyon bilgisini kullanarak bir alım-satım kararı üretmen isteniyor.

Karar kuralların:
1. Yalnızca verilen verilerle gerekçelendir; spekülasyon yapma.
2. Haber duygu durumunu (pozitif/negatif/nötr) fiyat hareketiyle birlikte değerlendir.
3. Güven skorun (confidence) 0.0-1.0 arasında samimi bir olasılık olsun; emin değilsen düşük ver.
4. Kararın mutlaka şu üçünden biri olmalı: BUY, SELL veya HOLD.
5. Gerekçeni (reasoning) en fazla 3 cümlede, Türkçe ve net biçimde yaz.
6. Öne çıkan riskleri varsa risks dizisinde listele (en fazla 5 madde).

Yanıtını daima şu JSON yapısında ver:
{"action": "BUY|SELL|HOLD", "confidence": 0.0-1.0, "reasoning": "...", "risks": ["..."]}`;

/** Varsayılan haber tarama promptu — günlük haber akışının filtrelenmesi için. */
export const DEFAULT_NEWS_SCAN_PROMPT = `Sen bir finansal haber editörüsün. Sana verilen günlük haber başlıklarını ve özetlerini Borsa İstanbul hisseleriyle eşleştirmen ve piyasa etkisi açısından sınıflandırman isteniyor.

Kuralların:
1. Her haberi ilgili hisse sembolleriyle eşleştir (örn. THYAO, ASELS, GARAN).
2. Piyasa etkisini değerlendir: pozitif, negatif veya nötr.
3. Yalnızca finansal açıdan anlamlı haberleri işaretle; magazin/ilişkisiz içerikleri eleme.
4. Her haber için kısa bir etki gerekçesi yaz (en fazla 2 cümle, Türkçe).

Yanıtını daima şu JSON yapısında ver:
{"articles": [{"title": "...", "symbols": ["THYAO"], "sentiment": "POSITIVE|NEGATIVE|NEUTRAL", "impactReasoning": "..."}]}`;

/** Risk parametreleri için varsayılan değerler. */
export const DEFAULT_RISK_SETTINGS = {
  stopLossPercent: 5,
  takeProfitPercent: 10,
  minConfidenceThreshold: 0.7,
  maxPositionValue: 50000,
  maxOpenPositions: 5,
  dailyOrderBudget: 100000,
  cooldownMinutes: 60,
  autoTradingEnabled: false,
  autoTradeIntervalSeconds: 60,
} as const;

/** Risk alanları için makul sınırlar — Zod validator'larla senkron tutulur. */
export const RISK_LIMITS = {
  stopLossPercent: { min: 0.5, max: 50 },
  takeProfitPercent: { min: 0.5, max: 100 },
  minConfidenceThreshold: { min: 0, max: 1 },
  maxPositionValue: { min: 1000, max: 10_000_000 },
  maxOpenPositions: { min: 1, max: 50 },
  dailyOrderBudget: { min: 1000, max: 100_000_000 },
  cooldownMinutes: { min: 0, max: 1440 },
  maxDailyLossLimit: { min: 0, max: 1_000_000 },
  maxBuyAmount: { min: 0, max: 500_000 },
  maxSellAmount: { min: 0, max: 500_000 },
  autoTradeIntervalSeconds: { min: 10, max: 3600 },
} as const;

/**
 * Döviz emirlerinde kullanılabilecek para birimleri (TRY hariç) —
 * DenizBank ChangeExchange TransactionType değerleriyle birebir eşleşir.
 *
 * Tek doğruluk kaynağı (iyileştirme 4.5): trading-service ve
 * live-trading-provider bu sabitten türetilir; liste değişirse yalnızca
 * burası güncellenir.
 */
export const SUPPORTED_FX_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD",
] as const;

/** Döviz emri para birimi union tipi — SUPPORTED_FX_CURRENCIES'ten türetilir. */
export type SupportedFxCurrency = (typeof SUPPORTED_FX_CURRENCIES)[number];
