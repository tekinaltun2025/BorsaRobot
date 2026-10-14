import { z } from "zod";

/**
 * AI Kararları API doğrulama şemaları — /api/ai-decisions* sorgularını ve
 * gövdelerini doğrular. Tüm hatalar Zod'un standart flatten çıktısıyla API
 * katmanına düşer; API katmanı bunları 422 + TR mesajla döner.
 */

/** BIST sembol formatı: 3–6 harf (trading.ts ile aynı sözleşme). */
const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,6}$/, "Sembol 3–6 harf olmalıdır (örn. THYAO).");

/** Karar listesi sorgusu — GET /api/ai-decisions?limit=&symbol=&action=&cursor=. */
export const decisionListQuerySchema = z
  .object({
    /** Sayfa boyutu (1–50). */
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** Sembol filtresi (opsiyonel). */
    symbol: symbolSchema.optional(),
    /** Eylem filtresi (opsiyonel): BUY | SELL | HOLD | SKIP. */
    action: z
      .enum(["BUY", "SELL", "HOLD", "SKIP"], {
        errorMap: () => ({
          message: "Eylem BUY, SELL, HOLD veya SKIP olmalıdır.",
        }),
      })
      .optional(),
    /** Sayfalama cursor'u — önceki sayfanın son kayıt id'si. */
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

export type DecisionListQuery = z.infer<typeof decisionListQuerySchema>;

/** Soru istek gövdesi — POST /api/ai-decisions/ask. */
export const askDecisionSchema = z
  .object({
    /** Kullanıcının AI'ya yönelttiği soru (3–2000 karakter). */
    question: z
      .string()
      .trim()
      .min(3, "Soru en az 3 karakter olmalıdır.")
      .max(2000, "Soru en fazla 2000 karakter olabilir."),
    /** Yanıta bağlam olarak dahil edilecek son karar sayısı (opsiyonel, 1–30). */
    decisionContextCount: z.coerce.number().int().min(1).max(30).optional(),
  })
  .strict();

export type AskDecisionBody = z.infer<typeof askDecisionSchema>;

/** Sohbet geçmişi sorgusu — GET /api/ai-decisions/chat?limit=. */
export const chatHistoryQuerySchema = z
  .object({
    /** Döndürülecek mesaj sayısı (1–200). */
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;
