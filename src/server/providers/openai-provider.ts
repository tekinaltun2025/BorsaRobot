import OpenAI from "openai";
import type { ILlmProvider } from "@/server/providers/llm-provider";
import {
  LlmApiError,
  LlmTimeoutError,
  withLlmTimeout,
} from "@/server/providers/llm-provider";
import type { ApiCallLogEntry } from "@/server/services/api-log-service";

/**
 * OpenAI implementasyonu — ILlmProvider sözleşmesi.
 *
 * Davranış sözleşmesi:
 *  - API key + model constructor'a enjekte edilir (factory AdminSettings'ten alır).
 *  - systemPrompt, chat rollerinde "system" kanalından gönderilir —
 *    prompt enjeksiyonuna karşı sistem talimatı veriden izole tutulur.
 *  - response_format: json_object — modelin JSON moduna geçmesini sağlar;
 *    yine de parser code fence temizliği yapar (savunmacı tasarım).
 *  - Her çağrı logApiCall ile ApiCallLog'a yazılır (istek özeti, süre, token, hata).
 *  - Timeout 30 sn (withLlmTimeout race deseni).
 *  - SDK hataları anlamlı TR mesajlara çevrilir (geçersiz key, kota, network).
 */

/** OpenAI API hata kodunu okunabilir sınıfa çevirir. */
function classifyOpenaiError(error: unknown): { code: string; message: string; httpStatus: number | null } {
  const apiError = error as { status?: number; message?: string; code?: string } | null;
  const status = typeof apiError?.status === "number" ? apiError.status : null;
  const rawMessage = typeof apiError?.message === "string" ? apiError.message : "Bilinmeyen OpenAI hatası";
  const rawCode = typeof apiError?.code === "string" ? apiError.code : "";

  if (status === 401 || /invalid api key|incorrect api key/i.test(rawMessage)) {
    return { code: "INVALID_API_KEY", message: "OpenAI API anahtarı geçersiz. Admin panelinden doğru anahtarı girin.", httpStatus: status ?? 401 };
  }
  if (status === 429 || /rate limit|quota/i.test(rawMessage)) {
    return { code: "RATE_LIMITED", message: "OpenAI API kotası aşıldı (429). Kısa süre sonra tekrar deneyin veya modeli değiştirin.", httpStatus: status ?? 429 };
  }
  if (status === 404 || /model.*not.*(found|exist)/i.test(rawMessage)) {
    return { code: "MODEL_NOT_FOUND", message: "OpenAI modeli bulunamadı. Admin panelinden geçerli bir model seçin.", httpStatus: status ?? 404 };
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|APIConnectionError/i.test(rawMessage) || rawCode === "APIConnectionError") {
    return { code: "NETWORK_ERROR", message: "OpenAI API'ye ulaşılamadı (ağ hatası). İnternet bağlantısını kontrol edin.", httpStatus: null };
  }
  return { code: "PROVIDER_ERROR", message: `OpenAI API hatası: ${rawMessage}`, httpStatus: status };
}

export class OpenAiLlmProvider implements ILlmProvider {
  readonly providerId = "OPENAI" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    /** ApiCallLog yazma portu — servis katmanından enjekte edilir. */
    private readonly logApiCall: (entry: ApiCallLogEntry) => Promise<void>,
  ) {
    if (!apiKey.trim()) {
      // Factory bu durumu zaten yakalar; savunma amaçlı ikinci bariyer.
      throw new LlmApiError(
        "OpenAI API anahtarı tanımlı değil. Admin panelinden ekleyin.",
        "MISSING_API_KEY",
      );
    }
  }

  async generateStructured(prompt: string, systemPrompt: string): Promise<string> {
    const startedAt = Date.now();
    const endpoint = `LLM:OPENAI:${this.model}`;
    const requestSummary = JSON.stringify({
      model: this.model,
      systemPromptLength: systemPrompt.length,
      promptLength: prompt.length,
    });

    try {
      const client = new OpenAI({ apiKey: this.apiKey, timeout: 30_000, maxRetries: 0 });

      const completion = await withLlmTimeout(
        client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 2048,
          response_format: { type: "json_object" },
        }),
      );

      const responseText = completion.choices[0]?.message?.content ?? "";
      const usage = completion.usage;
      const durationMs = Date.now() - startedAt;

      // Token bilgisi varsa yanıt özetine eklenir (ApiCallLog tek metin alanı).
      const tokenInfo =
        usage !== undefined && usage !== null
          ? ` | tokens: prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}, total=${usage.total_tokens ?? "?"}`
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
          "OpenAI boş yanıt döndü. Modeli değiştirip tekrar deneyin.",
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

      const classified = classifyOpenaiError(error);
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
        "Yalnızca şu JSON'u döndür, başka hiçbir şey yazma: {\"reply\":\"PONG\"}",
        "Sen bir bağlantı testi yardımcısısın. Kullanıcı istemine yalnızca istenen JSON ile yanıt verirsin.",
      );
      const trimmed = reply.trim();
      return {
        ok: true,
        message: `OpenAI bağlantısı başarılı (${this.model}) — yanıt: "${trimmed.slice(0, 40)}"`,
      };
    } catch (error: unknown) {
      if (error instanceof LlmApiError || error instanceof LlmTimeoutError) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: `OpenAI bağlantı testi başarısız: ${String(error)}` };
    }
  }
}
