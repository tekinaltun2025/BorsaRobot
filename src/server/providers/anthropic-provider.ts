import Anthropic from "@anthropic-ai/sdk";
import type { ILlmProvider } from "@/server/providers/llm-provider";
import {
  LlmApiError,
  LlmTimeoutError,
  withLlmTimeout,
} from "@/server/providers/llm-provider";
import type { ApiCallLogEntry } from "@/server/services/api-log-service";

/**
 * Anthropic Claude implementasyonu — ILlmProvider sözleşmesi.
 *
 * Davranış sözleşmesi:
 *  - API key + model constructor'a enjekte edilir (factory AdminSettings'ten alır).
 *  - Messages API (/v1/messages) kullanılır; `anthropic-version` header'ı
 *    SDK tarafından otomatik eklenir.
 *  - systemPrompt, Messages API'nin ayrı `system` parametresinden gönderilir —
 *    prompt enjeksiyonuna karşı sistem talimatı veriden izole tutulur.
 *  - generateStructured ham metin döner; JSON çıkarma/Zod doğrulama parser'a aittir.
 *  - Her çağrı logApiCall ile ApiCallLog'a yazılır (istek özeti, süre, token, hata).
 *  - Timeout 30 sn (withLlmTimeout race deseni).
 *  - SDK hataları anlamlı TR mesajlara çevrilir (geçersiz key, kota, network).
 */

/** Anthropic SDK hata yanıtı — bilinen alanlar üzerinden sınıflandırma. */
interface AnthropicErrorShape {
  message?: string;
  status?: number;
  error?: { type?: string; message?: string };
}

/** Anthropic API hata kodunu okunabilir sınıfa çevirir. */
function classifyAnthropicError(error: unknown): { code: string; message: string; httpStatus: number | null } {
  const shape = error as AnthropicErrorShape | null;
  const rawMessage =
    typeof shape?.message === "string"
      ? shape.message
      : typeof shape?.error?.message === "string"
        ? shape.error.message
        : "Bilinmeyen Anthropic hatası";
  const status = typeof shape?.status === "number" ? shape.status : null;
  const errorType = typeof shape?.error?.type === "string" ? shape.error.type : "";

  if (status === 401 || /invalid x-api-key|invalid api key|authentication/i.test(rawMessage)) {
    return { code: "INVALID_API_KEY", message: "Anthropic API anahtarı geçersiz. Admin panelinden doğru anahtarı girin.", httpStatus: status ?? 401 };
  }
  if (status === 429 || /rate.?limit|overloaded/i.test(rawMessage) || errorType === "rate_limit_error" || errorType === "overloaded_error") {
    return { code: "RATE_LIMITED", message: "Anthropic API kotası aşıldı (429). Kısa süre sonra tekrar deneyin veya modeli değiştirin.", httpStatus: status ?? 429 };
  }
  if (status === 404 || /not.?found/i.test(rawMessage) || errorType === "not_found_error") {
    return { code: "MODEL_NOT_FOUND", message: "Anthropic modeli bulunamadı. Admin panelinden geçerli bir model seçin.", httpStatus: status ?? 404 };
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|APIConnectionError/i.test(rawMessage)) {
    return { code: "NETWORK_ERROR", message: "Anthropic API'ye ulaşılamadı (ağ hatası). İnternet bağlantısını kontrol edin.", httpStatus: null };
  }
  return { code: "PROVIDER_ERROR", message: `Anthropic API hatası: ${rawMessage}`, httpStatus: status };
}

export class AnthropicLlmProvider implements ILlmProvider {
  readonly providerId = "ANTHROPIC" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    /** ApiCallLog yazma portu — servis katmanından enjekte edilir. */
    private readonly logApiCall: (entry: ApiCallLogEntry) => Promise<void>,
  ) {
    if (!apiKey.trim()) {
      // Factory bu durumu zaten yakalar; savunma amaçlı ikinci bariyer.
      throw new LlmApiError(
        "Anthropic API anahtarı tanımlı değil. Admin panelinden ekleyin.",
        "MISSING_API_KEY",
      );
    }
  }

  async generateStructured(prompt: string, systemPrompt: string): Promise<string> {
    const startedAt = Date.now();
    const endpoint = `LLM:ANTHROPIC:${this.model}`;
    const requestSummary = JSON.stringify({
      model: this.model,
      systemPromptLength: systemPrompt.length,
      promptLength: prompt.length,
    });

    try {
      const client = new Anthropic({
        apiKey: this.apiKey,
        timeout: 30_000,
        maxRetries: 0,
      });

      const message = await withLlmTimeout(
        client.messages.create({
          model: this.model,
          max_tokens: 2048,
          // systemPrompt Messages API'nin ayrı system parametresi —
          // veriden izole kanal (prompt enjeksiyonu koruması).
          system: systemPrompt,
          messages: [
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      );

      // Content bloklarından metin bloklarını birleştirir (SDK Content tipi).
      const responseText = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const usage = message.usage;
      const durationMs = Date.now() - startedAt;

      // Token bilgisi varsa yanıt özetine eklenir (ApiCallLog tek metin alanı).
      const tokenInfo =
        usage !== undefined && usage !== null
          ? ` | tokens: prompt=${usage.input_tokens ?? "?"}, completion=${usage.output_tokens ?? "?"}`
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
          "Anthropic boş yanıt döndü. Modeli değiştirip tekrar deneyin.",
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

      const classified = classifyAnthropicError(error);
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
        'Yalnızca şu JSON\'u döndür, başka hiçbir şey yazma: {"reply":"PONG"}',
        "Sen bir bağlantı testi yardımcısısın. Kullanıcı istemine yalnızca istenen JSON ile yanıt verirsin.",
      );
      const trimmed = reply.trim();
      return {
        ok: true,
        message: `Anthropic bağlantısı başarılı (${this.model}) — yanıt: "${trimmed.slice(0, 40)}"`,
      };
    } catch (error: unknown) {
      if (error instanceof LlmApiError || error instanceof LlmTimeoutError) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: `Anthropic bağlantı testi başarısız: ${String(error)}` };
    }
  }
}
