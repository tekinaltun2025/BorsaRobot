import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ILlmProvider } from "@/server/providers/llm-provider";
import {
  LlmApiError,
  LlmTimeoutError,
  withLlmTimeout,
} from "@/server/providers/llm-provider";
import type { ApiCallLogEntry } from "@/server/services/api-log-service";

/**
 * Genel OpenAI-uyumlu LLM sağlayıcısı — ILlmProvider sözleşmesi.
 *
 * TEK implementasyonla birden fazla sağlayıcıyı kapsar:
 *  - DEEPSEEK:  https://api.deepseek.com      (bulut, key zorunlu)
 *  - GROK/xAI:  https://api.x.ai/v1          (bulut, key zorunlu)
 *  - MISTRAL:   https://api.mistral.ai/v1    (bulut, key zorunlu)
 *  - NVIDIA:    https://integrate.api.nvidia.com/v1 (bulut, key zorunlu,
 *               reasoning_effort parametresi destekler)
 *  - CUSTOM:    local AI (Ollama http://localhost:11434/v1, LM Studio
 *               http://localhost:1234/v1, vLLM vb.) — key opsiyonel.
 *
 * Davranış sözleşmesi:
 *  - baseURL + API key + model constructor'a enjekte edilir (factory üretir).
 *  - Local AI'larda API key opsiyoneldir: key boşsa Authorization header'ı
 *    hiç eklenmez (Ollama key istemez; boş "Bearer " header'ı bazı sunucularda
 *    401 ürettiği için tamamen atlanır).
 *  - systemPrompt, chat rollerinde "system" kanalından gönderilir.
 *  - response_format: json_object — desteklemeyen local modellerde bu alan
 *    yoksayılabilir; parser code fence temizliğiyle savunmacı çalışır.
 *  - Her çağrı logApiCall ile ApiCallLog'a yazılır.
 *  - Timeout 30 sn (withLlmTimeout race deseni).
 *  - SDK hataları anlamlı TR mesajlara çevrilir.
 */

/**
 * NVIDIA NIM, OpenAI şemasının bir üst kümesini kullanır: standart
 * `reasoning_effort` değerlerine ("low" | "medium" | "high") ek olarak
 * "max" seviyesini destekler. SDK tipi "max"ı içermediğinden parametre
 * tipi `any` kullanmadan bu intersection ile genişletilir (type-safe).
 */
type ChatCompletionRequestParams = Omit<
  ChatCompletionCreateParamsNonStreaming,
  "reasoning_effort"
> & {
  reasoning_effort?: "low" | "medium" | "high" | "max";
};

/**
 * Reasoning modelleri (NVIDIA NIM vb.) standart `content` alanına ek olarak
 * `reasoning_content` (iç düşünce akışı) döndürebilir. SDK tipi bu alanı
 * içermediğinden mesaj tipi bu intersection ile genişletilir (type-safe).
 */
type ChatCompletionReasoningMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

/** OpenAI-uyumlu sağlayıcı hata kodunu okunabilir sınıfa çevirir. */
function classifyCompatibleError(
  providerLabel: string,
  error: unknown,
): { code: string; message: string; httpStatus: number | null } {
  const apiError = error as { status?: number; message?: string; code?: string } | null;
  const status = typeof apiError?.status === "number" ? apiError.status : null;
  const rawMessage = typeof apiError?.message === "string" ? apiError.message : "Bilinmeyen hata";
  const rawCode = typeof apiError?.code === "string" ? apiError.code : "";

  if (status === 401 || /invalid api key|incorrect api key|unauthorized/i.test(rawMessage)) {
    return {
      code: "INVALID_API_KEY",
      message: `${providerLabel} API anahtarı geçersiz. Admin panelinden doğru anahtarı girin.`,
      httpStatus: status ?? 401,
    };
  }
  if (status === 429 || /rate limit|quota/i.test(rawMessage)) {
    return {
      code: "RATE_LIMITED",
      message: `${providerLabel} API kotası aşıldı (429). Kısa süre sonra tekrar deneyin veya modeli değiştirin.`,
      httpStatus: status ?? 429,
    };
  }
  if (status === 404 || /model.*not.*(found|exist)|no such model/i.test(rawMessage)) {
    return {
      code: "MODEL_NOT_FOUND",
      message: `${providerLabel} modeli bulunamadı. Admin panelinden geçerli bir model seçin veya model adını kontrol edin.`,
      httpStatus: status ?? 404,
    };
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|APIConnectionError|connect/i.test(rawMessage) || rawCode === "APIConnectionError") {
    return {
      code: "NETWORK_ERROR",
      message: `${providerLabel} sunucusuna ulaşılamadı (ağ hatası). Base URL'i ve sunucunun çalıştığını kontrol edin.`,
      httpStatus: null,
    };
  }
  return { code: "PROVIDER_ERROR", message: `${providerLabel} API hatası: ${rawMessage}`, httpStatus: status };
}

export class OpenAiCompatibleLlmProvider implements ILlmProvider {
  /** AdminSettings.aiProvider değeri (DEEPSEEK | GROK | MISTRAL | NVIDIA | CUSTOM). */
  readonly providerId: "DEEPSEEK" | "GROK" | "MISTRAL" | "NVIDIA" | "CUSTOM";
  readonly model: string;
  /** Log ve hata mesajlarında kullanılan okunabilir ad (örn. "DeepSeek", "Local AI"). */
  private readonly providerLabel: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /**
   * NVIDIA NIM'e özgü reasoning_effort seviyesi — yalnızca providerId=NVIDIA'da
   * istek gövdesine eklenir ("max" = en derin akıl yürütme).
   */
  private readonly reasoningEffort: "max" | null;
  /** ApiCallLog yazma portu — servis katmanından enjekte edilir. */
  private readonly logApiCall: (entry: ApiCallLogEntry) => Promise<void>;
  /**
   * Son generateStructured çağrısının reasoning_content alanı (iç düşünce
   * akışı) — reasoning modeli döndürmediğinde null kalır.
   */
  private lastReasoningContent: string | null = null;

  constructor(params: {
    providerId: "DEEPSEEK" | "GROK" | "MISTRAL" | "NVIDIA" | "CUSTOM";
    /** OpenAI-uyumlu base URL (örn. https://api.deepseek.com, http://localhost:11434/v1). */
    baseUrl: string;
    /** API key — bulut sağlayıcılarda zorunlu, local'da opsiyonel (boş geçilebilir). */
    apiKey: string;
    model: string;
    /** NVIDIA NIM için reasoning_effort ("max"); diğer sağlayıcılarda verilmez. */
    reasoningEffort?: "max";
    logApiCall: (entry: ApiCallLogEntry) => Promise<void>;
  }) {
    this.providerId = params.providerId;
    this.providerLabel =
      params.providerId === "CUSTOM"
        ? "Local AI"
        : params.providerId === "DEEPSEEK"
          ? "DeepSeek"
          : params.providerId === "GROK"
            ? "Grok"
            : params.providerId === "MISTRAL"
              ? "Mistral"
              : params.providerId === "NVIDIA"
                ? "NVIDIA"
                : "Local AI";
    this.reasoningEffort =
      params.providerId === "NVIDIA" ? (params.reasoningEffort ?? "max") : null;
    this.baseUrl = params.baseUrl.replace(/\/+$/, "");
    this.apiKey = params.apiKey.trim();
    this.model = params.model;
    this.logApiCall = params.logApiCall;

    if (!this.baseUrl) {
      // Factory bu durumu zaten yakalar; savunma amaçlı ikinci bariyer.
      throw new LlmApiError(
        "Local AI için Base URL girin (örn. http://localhost:11434/v1).",
        "MISSING_BASE_URL",
      );
    }
    if (!this.model.trim()) {
      throw new LlmApiError(
        `${this.providerLabel} model adı tanımlı değil. Admin panelinden girin.`,
        "MISSING_MODEL",
      );
    }
  }

  async generateStructured(prompt: string, systemPrompt: string): Promise<string> {
    const startedAt = Date.now();
    const endpoint = `LLM:${this.providerId}:${this.model}`;
    const requestSummary = JSON.stringify({
      provider: this.providerId,
      baseUrl: this.baseUrl,
      model: this.model,
      systemPromptLength: systemPrompt.length,
      promptLength: prompt.length,
    });

    try {
      // Local AI'da key boşsa Authorization header'ı tamamen atlanır —
      // SDK'da null değer header'ı kaldırır (boş "Bearer " 401 üretir).
      const client = new OpenAI({
        apiKey: this.apiKey || "no-key-required",
        baseURL: `${this.baseUrl}/`,
        timeout: 30_000,
        maxRetries: 0,
        defaultHeaders: this.apiKey ? undefined : { Authorization: null },
      });

      // NVIDIA NIM'e özgü reasoning_effort parametresi — yalnızca NVIDIA'da
      // istek gövdesine eklenir; diğer sağlayıcılara gönderilmez.
      const requestParams: ChatCompletionRequestParams = {
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
        // response_format tüm OpenAI-uyumlu sunucularda desteklenmez;
        // desteklemeyenler yoksayar, destekleyenler JSON moduna geçer.
        response_format: { type: "json_object" },
        ...(this.reasoningEffort !== null
          ? { reasoning_effort: this.reasoningEffort }
          : {}),
      };

      // NVIDIA'nın "max" değeri SDK union'ında bulunmadığı için tek noktada
      // genişletilmiş tipe daraltılır — gövde alanları birebir uyumludur.
      const completion = await withLlmTimeout(
        client.chat.completions.create(
          requestParams as ChatCompletionCreateParamsNonStreaming,
        ),
      );

      // Reasoning modelleri (NVIDIA NIM vb.) iç düşünce akışını ayrı alanda
      // döndürebilir — yakalanır ve getLastReasoningContent() ile sunulur.
      const reasoningMessage = completion.choices[0]?.message as
        | ChatCompletionReasoningMessage
        | undefined;
      const reasoningContent = reasoningMessage?.reasoning_content;
      this.lastReasoningContent =
        typeof reasoningContent === "string" && reasoningContent.trim().length > 0
          ? reasoningContent.slice(0, 20_000)
          : null;

      const responseText = completion.choices[0]?.message?.content ?? "";
      const usage = completion.usage;
      const durationMs = Date.now() - startedAt;

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
          `${this.providerLabel} boş yanıt döndü. Modeli değiştirip tekrar deneyin.`,
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

      const classified = classifyCompatibleError(this.providerLabel, error);
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

  /** Son çağrının iç düşünce akışı — AiDecisionLog.innerMonologue kaynağı. */
  getLastReasoningContent(): string | null {
    return this.lastReasoningContent;
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
        message: `${this.providerLabel} bağlantısı başarılı (${this.model} @ ${this.baseUrl}) — yanıt: "${trimmed.slice(0, 40)}"`,
      };
    } catch (error: unknown) {
      if (error instanceof LlmApiError || error instanceof LlmTimeoutError) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: `${this.providerLabel} bağlantı testi başarısız: ${String(error)}` };
    }
  }
}
