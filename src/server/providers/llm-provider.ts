import type { AiProvider } from "@/lib/types";

/**
 * LLM sağlayıcı sözleşmesi — Strategy Pattern (ADR-4, Bölüm 4.8).
 *
 * İki implementasyon:
 *  - GeminiLlmProvider: Google Gemini (@google/generative-ai).
 *  - OpenAiLlmProvider: OpenAI (openai).
 *
 * INVARIANT'LAR (her implementasyon bu kurallara uyar):
 *  1. generateStructured() HAM METİN döner — JSON parse/Zod doğrulama
 *     llm-response-parser'ın sorumluluğudur (tek retry mekanizması orada).
 *  2. Sağlayıcı farkı (Gemini systemInstruction / OpenAI json_object mode)
 *     provider içinde kapsüllenir; çağıran taraf her zaman aynı sözleşmeyi alır.
 *  3. Her çağrı (başarı/hata) enjekte edilen logApiCall helper'ı ile
 *     ApiCallLog'a kaydedilir — provider Prisma'ya doğrudan dokunmaz.
 *  4. API key doğrulaması factory'dedir; provider'a daima dolu key gelir.
 *  5. Timeout 30 sn — aşımında LlmTimeoutError fırlatılır, asla asılı kalınmaz.
 */

/** LLM katmanı hata tipleri — API katmanı bunları HTTP durumlarına map eder. */

/** Yapılandırma hatası — API key yok/geçersiz. HTTP 400/422'ye map edilir. */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/** Zaman aşımı — HTTP 504'e map edilir. */
export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

/** Sağlayıcı API hatası (network, kota, geçersiz key vb.) — HTTP 502'ye map edilir. */
export class LlmApiError extends Error {
  constructor(
    message: string,
    /** Sağlayıcı hata kodu (örn. "INVALID_API_KEY", "RATE_LIMITED"). */
    readonly code: string = "PROVIDER_ERROR",
    /** HTTP durum kodu (varsa). */
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "LlmApiError";
  }
}

/** LLM yanıtı parse/doğrulama hatası — HTTP 502'ye map edilir. */
export class LlmParseError extends Error {
  constructor(
    message: string,
    /** Ham LLM yanıtı — log kaydı için taşınır. */
    readonly rawResponse?: string,
  ) {
    super(message);
    this.name = "LlmParseError";
  }
}

/** LLM sağlayıcı arayüzü — sağlayıcı bağımsız sözleşme. */
export interface ILlmProvider {
  /** Sağlayıcı kimliği — AdminSettings.aiProvider değeriyle eşleşir. */
  readonly providerId: AiProvider;
  /** Kullanılan model adı (örn. "gemini-2.0-flash", "gpt-4o"). */
  readonly model: string;

  /**
   * Yapılandırılmış çıktı üretir — ham metin döner.
   *
   * @param prompt       Kullanıcı istemi (analiz veri bloğu).
   * @param systemPrompt Sistem talimatı (AdminSettings.systemPrompt) —
   *                     prompt enjeksiyonuna karşı veriden AYRI tutulur.
   */
  generateStructured(prompt: string, systemPrompt: string): Promise<string>;

  /** Sağlayıcı bağlantı testi — admin paneli "Test Et" düğmesi. */
  testConnection(): Promise<{ ok: boolean; message: string }>;

  /**
   * Son generateStructured çağrısının iç düşünce akışı (reasoning_content) —
   * yalnızca reasoning çıktısı üreten sağlayıcılarda (NVIDIA NIM "max" çabası
   * vb.) dolu döner. Opsiyonel üyedir: uygulamayan sağlayıcılarda çağıran
   * taraf null varsayar (AiDecisionLog.innerMonologue kaynağı).
   */
  getLastReasoningContent?(): string | null;
}

/** LLM çağrısı timeout'u (ms) — kalite standardı: 30 sn. */
export const LLM_TIMEOUT_MS = 30_000;

/**
 * Promise'e timeout uygular — aşımında LlmTimeoutError reddeder.
 * Sağlayıcı SDK'ları abort sinyalini tutarlı desteklemediğinden, race
 * deseni her iki implementasyonda aynı davranışı garanti eder.
 */
export function withLlmTimeout<T>(promise: Promise<T>, ms: number = LLM_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new LlmTimeoutError(`LLM çağrısı ${Math.round(ms / 1000)} saniyede yanıtlanmadı (timeout).`)), ms);
    }),
  ]);
}
