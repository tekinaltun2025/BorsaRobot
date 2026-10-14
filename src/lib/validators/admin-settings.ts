import { z } from "zod";
import { RISK_LIMITS } from "@/lib/constants";

/**
 * Admin ayarları güncelleme şeması — PUT /api/admin/settings gövdesini doğrular.
 *
 * Tüm alanlar opsiyoneldir (kısmi güncelleme); yalnızca gönderilen alanlar
 * güncellenir. API anahtarları boş string gönderilirse "temizle" anlamına
 * gelir; undefined gönderilirse dokunulmaz.
 *
 * Koşullu doğrulama: aiProvider=CUSTOM seçiliyken customBaseUrl zorunludur
 * (local AI sunucusunun adresi olmadan bağlantı kurulamaz).
 */

/** OpenAI-uyumlu base URL doğrulaması — http/https şeması zorunlu. */
const customBaseUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https?:\/\/.+/i.test(value),
    { message: "Base URL http:// veya https:// ile başlamalıdır (örn. http://localhost:11434/v1)." },
  );

export const adminSettingsUpdateSchema = z
  .object({
    tradingMode: z.enum(["PAPER", "LIVE"]).optional(),
    aiProvider: z.enum(["GEMINI", "OPENAI", "ANTHROPIC", "DEEPSEEK", "GROK", "MISTRAL", "NVIDIA", "CUSTOM"]).optional(),

    // API anahtarları: boş string = temizle; dolu string = yeni anahtar.
    geminiApiKey: z.string().max(500).optional(),
    openaiApiKey: z.string().max(500).optional(),
    anthropicApiKey: z.string().max(500).optional(),
    deepseekApiKey: z.string().max(500).optional(),
    grokApiKey: z.string().max(500).optional(),
    mistralApiKey: z.string().max(500).optional(),
    nvidiaApiKey: z.string().max(500).optional(),

    // Local/custom sağlayıcı (Ollama, LM Studio, vLLM vb.).
    customBaseUrl: customBaseUrlSchema.optional(),
    customApiKey: z.string().max(500).optional(),
    customModel: z.string().max(200).optional(),

    geminiModel: z.string().min(1).max(100).optional(),
    openaiModel: z.string().min(1).max(100).optional(),
    anthropicModel: z.string().min(1).max(100).optional(),
    deepseekModel: z.string().min(1).max(100).optional(),
    grokModel: z.string().min(1).max(100).optional(),
    mistralModel: z.string().min(1).max(100).optional(),
    nvidiaModel: z.string().min(1).max(100).optional(),

    systemPrompt: z.string().min(1).max(20000).optional(),
    newsScanPrompt: z.string().min(1).max(20000).optional(),

    stopLossPercent: z.coerce
      .number()
      .min(RISK_LIMITS.stopLossPercent.min)
      .max(RISK_LIMITS.stopLossPercent.max)
      .optional(),
    takeProfitPercent: z.coerce
      .number()
      .min(RISK_LIMITS.takeProfitPercent.min)
      .max(RISK_LIMITS.takeProfitPercent.max)
      .optional(),
    minConfidenceThreshold: z.coerce
      .number()
      .min(RISK_LIMITS.minConfidenceThreshold.min)
      .max(RISK_LIMITS.minConfidenceThreshold.max)
      .optional(),
    maxPositionValue: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.maxPositionValue.min)
      .max(RISK_LIMITS.maxPositionValue.max)
      .optional(),
    maxOpenPositions: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.maxOpenPositions.min)
      .max(RISK_LIMITS.maxOpenPositions.max)
      .optional(),
    dailyOrderBudget: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.dailyOrderBudget.min)
      .max(RISK_LIMITS.dailyOrderBudget.max)
      .optional(),
    cooldownMinutes: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.cooldownMinutes.min)
      .max(RISK_LIMITS.cooldownMinutes.max)
      .optional(),

    // Faz 5: otomatik alım-satım motoru anahtarı + döngü aralığı.
    autoTradingEnabled: z.boolean().optional(),
    autoTradeIntervalSeconds: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.autoTradeIntervalSeconds.min)
      .max(RISK_LIMITS.autoTradeIntervalSeconds.max)
      .optional(),

    // Risk limitleri (Faz 5 genişletme).
    maxDailyLossLimit: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.maxDailyLossLimit.min)
      .max(RISK_LIMITS.maxDailyLossLimit.max)
      .optional(),
    maxBuyAmount: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.maxBuyAmount.min)
      .max(RISK_LIMITS.maxBuyAmount.max)
      .optional(),
    maxSellAmount: z.coerce
      .number()
      .int()
      .min(RISK_LIMITS.maxSellAmount.min)
      .max(RISK_LIMITS.maxSellAmount.max)
      .optional(),
    autoTradeApprovalMode: z.enum(["MANUAL", "AUTO"]).optional(),

    // Fiyat kaynağı: YAHOO (gerçek BIST — Yahoo Finance) | SIMULATED (yedek).
    priceSource: z.enum(["YAHOO", "SIMULATED"]).optional(),

    newsSources: z
      .array(z.enum(["GOOGLE_NEWS", "BIGPARA", "CUSTOM_RSS"]))
      .min(1)
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: "Güncellenecek en az bir alan gönderilmelidir." },
  )
  // Koşullu doğrulama: CUSTOM seçiliyken customBaseUrl zorunlu.
  // Not: Kısmi güncelleme deseni gereği yalnızca istekte aiProvider=CUSTOM
  // taşındığında kontrol edilir; DB'de mevcut CUSTOM + ayrı base URL
  // güncellemesi factory tarafında zorunlulukla yakalanır.
  .superRefine((data, ctx) => {
    if (data.aiProvider === "CUSTOM") {
      const baseUrl = data.customBaseUrl;
      // Base URL hiç gönderilmediyse DB'de mevcut değer kullanılabilir;
      // boş string gönderildiyse (temizleme) reddedilir.
      if (baseUrl !== undefined && baseUrl.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customBaseUrl"],
          message: "Local AI (Custom) sağlayıcı için Base URL zorunludur (örn. http://localhost:11434/v1).",
        });
      }
    }
  });

export type AdminSettingsUpdate = z.infer<typeof adminSettingsUpdateSchema>;

/**
 * Model listesi çekme gövdesi — POST /api/admin/list-models.
 *
 * Local AI (Custom) sunucusundan OpenAI-uyumlu /v1/models endpoint'iyle
 * kurulu model listesi çekilir. baseUrl http/https şemasıyla zorunludur
 * (SSRF'e karşı format doğrulaması; localhost/LAN adreslerine local AI
 * kullanım senaryosu gereği açıkça izin verilir). apiKey opsiyoneldir —
 * Ollama key istemez, LM Studio/vLLM gibi sunucularda istenebilir.
 */
export const listModelsSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .min(1, "Base URL zorunludur (örn. http://localhost:11434/v1).")
      .max(500, "Base URL en fazla 500 karakter olabilir.")
      .refine((value) => /^https?:\/\/.+/i.test(value), {
        message: "Base URL http:// veya https:// ile başlamalıdır (örn. http://localhost:11434/v1).",
      }),
    apiKey: z.string().max(500).optional(),
  })
  .strict();

export type ListModelsBody = z.infer<typeof listModelsSchema>;
