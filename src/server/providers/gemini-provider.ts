import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ILlmProvider } from "@/server/providers/llm-provider";
import {
  LlmApiError,
  LlmTimeoutError,
  withLlmTimeout,
} from "@/server/providers/llm-provider";
import type { ApiCallLogEntry } from "@/server/services/api-log-service";

/**
 * Google Gemini implementasyonu — ILlmProvider sözleşmesi.
 *
 * Davranış sözleşmesi:
 *  - API key + model constructor'a enjekte edilir (factory AdminSettings'ten alır).
 *  - systemPrompt, systemInstruction olarak ayrı kanaldan gönderilir —
 *    prompt enjeksiyonuna karşı sistem talimatı veriden izole tutulur.
 *  - generateStructured ham metin döner; JSON çıkarma/Zod doğrulama parser'a aittir.
 *  - Her çağrı logApiCall ile ApiCallLog'a yazılır (istek özeti, süre, token, hata).
 *  - Timeout 30 sn (withLlmTimeout race deseni).
 *  - SDK hataları anlamlı TR mesajlara çevrilir (geçersiz key, kota, network).
 */

/** Gemini SDK hata yanıtı — bilinen alanlar üzerinden sınıflandırma. */
interface GeminiErrorShape {
  message?: string;
  status?: number;
  code?: number;
}

/** Gemini API hata kodunu okunabilir sınıfa çevirir. */
function classifyGeminiError(error: unknown): { code: string; message: string; httpStatus: number | null } {
  const shape = error as GeminiErrorShape | null;
  const rawMessage = typeof shape?.message === "string" ? shape.message : "Bilinmeyen Gemini hatası";
  const status = typeof shape?.status === "number" ? shape.status : null;

  if (/api key not valid|api_key_invalid|invalid api key/i.test(rawMessage)) {
    return { code: "INVALID_API_KEY", message: "Gemini API anahtarı geçersiz. Admin panelinden doğru anahtarı girin.", httpStatus: status };
  }
  if (/quota|resource.?exhausted|429/i.test(rawMessage)) {
    return { code: "RATE_LIMITED", message: "Gemini API kotası aşıldı (429). Kısa süre sonra tekrar deneyin veya modeli değiştirin.", httpStatus: status ?? 429 };
  }
  if (/not found|404/i.test(rawMessage)) {
    return { code: "MODEL_NOT_FOUND", message: "Gemini modeli bulunamadı. Admin panelinden geçerli bir model seçin.", httpStatus: status ?? 404 };
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(rawMessage)) {
    return { code: "NETWORK_ERROR", message: "Gemini API'ye ulaşılamadı (ağ hatası). İnternet bağlantısını kontrol edin.", httpStatus: null };
  }
  return { code: "PROVIDER_ERROR", message: `Gemini API hatası: ${rawMessage}`, httpStatus: status };
}

export class GeminiLlmProvider implements ILlmProvider {
  readonly providerId = "GEMINI" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    /** ApiCallLog yazma portu — servis katmanından enjekte edilir. */
    private readonly logApiCall: (entry: ApiCallLogEntry) => Promise<void>,
  ) {
    if (!apiKey.trim()) {
      // Factory bu durumu zaten yakalar; savunma amaçlı ikinci bariyer.
      throw new LlmApiError(
        "Gemini API anahtarı tanımlı değil. Admin panelinden ekleyin.",
        "MISSING_API_KEY",
      );
    }
  }

  async generateStructured(prompt: string, systemPrompt: string): Promise<string> {
    const startedAt = Date.now();
    const endpoint = `LLM:GEMINI:${this.model}`;
    const requestSummary = JSON.stringify({
      model: this.model,
      systemPromptLength: systemPrompt.length,
      promptLength: prompt.length,
    });

    try {
      const genAi = new GoogleGenerativeAI(this.apiKey);
      const generativeModel = genAi.getGenerativeModel(
        { model: this.model },
        // API sürümü sabitlenir — model listesi v1beta'da yaşamaktadır.
        { apiVersion: "v1beta" },
      );

      const result = await withLlmTimeout(
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // systemInstruction string olarak gönderilir — SDK Content tipi
          // role alanı zorunlu kıldığından string biçim tip güvenlidir.
          systemInstruction: systemPrompt,
          generationConfig: {
            // Yapılandırılmış JSON çıktısı için düşük sıcaklık.
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      );

      const responseText = result.response.text();
      const usage = result.response.usageMetadata;
      const durationMs = Date.now() - startedAt;

      // Token bilgisi varsa yanıt özetine eklenir (ApiCallLog tek metin alanı).
      const tokenInfo =
        usage !== undefined && usage !== null
          ? ` | tokens: prompt=${usage.promptTokenCount ?? "?"}, candidates=${usage.candidatesTokenCount ?? "?"}, total=${usage.totalTokenCount ?? "?"}`
          : "";

      await this.logApiCall({
        endpoint,
        requestBody: requestSummary,
        responseBody: `${responseText.slice(0, 2000)}${tokenInfo}`,
        httpStatus: 200,
        durationMs,
      });

      if (!responseText.trim()) {
        throw new LlmApiError(
          "Gemini boş yanıt döndü. Modeli değiştirip tekrar deneyin.",
          "EMPTY_RESPONSE",
        );
      }

      return responseText;
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;

      if (error instanceof LlmTimeoutError) {
        await this.logApiCall({
          endpoint,
          requestBody: requestSummary,
          httpStatus: null,
          errorClass: "TRANSIENT",
          errorCode: "TIMEOUT",
          durationMs,
        });
        throw error;
      }

      const classified = classifyGeminiError(error);
      await this.logApiCall({
        endpoint,
        requestBody: requestSummary,
        httpStatus: classified.httpStatus,
        errorClass: classified.code === "NETWORK_ERROR" || classified.code === "RATE_LIMITED" ? "TRANSIENT" : "PERMANENT",
        errorCode: classified.code,
        durationMs,
      });
      throw new LlmApiError(classified.message, classified.code, classified.httpStatus);
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const reply = await this.generateStructured(
        "Yalnızca şu kelimeyi yaz, başka hiçbir şey yazma: PONG",
        "Sen bir bağlantı testi yardımcısısın. Kullanıcı istemine tek kelimelik yanıt verirsin.",
      );
      const trimmed = reply.trim();
      return {
        ok: true,
        message: `Gemini bağlantısı başarılı (${this.model}) — yanıt: "${trimmed.slice(0, 40)}"`,
      };
    } catch (error: unknown) {
      if (error instanceof LlmApiError || error instanceof LlmTimeoutError) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: `Gemini bağlantı testi başarısız: ${String(error)}` };
    }
  }
}
