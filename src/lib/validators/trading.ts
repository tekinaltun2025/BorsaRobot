import { z } from "zod";

/**
 * Trading API doğrulama şemaları — /api/trading/* gövdelerini ve sorgularını
 * doğrular. Tüm hatalar Zod'un standart flatten çıktısıyla API katmanına
 * düşer; API katmanı bunları 422 + TR mesajla döner.
 */

/** BIST sembol formatı: 3–6 harf (örn. THYAO, ISCTR, GARAN). */
const symbolSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3,6}$/, "Sembol 3–6 harf olmalıdır (örn. THYAO).");

/** Tamsayı lot — 1'den büyük, makul üst sınır (tek emirde 1.000.000 adet). */
const quantitySchema = z.coerce
  .number()
  .int("Miktar tamsayı (lot) olmalıdır.")
  .min(1, "Miktar en az 1 olmalıdır.")
  .max(1_000_000, "Miktar en fazla 1.000.000 olabilir.");

/** Idempotency anahtarı — UUID formatı (client üretir). */
const clientRequestIdSchema = z
  .string()
  .uuid("clientRequestId geçerli bir UUID olmalıdır.");

/** Emir istek gövdesi — POST /api/trading/order. */
export const placeOrderSchema = z
  .object({
    side: z.enum(["BUY", "SELL"], {
      errorMap: () => ({ message: "Emir yönü BUY veya SELL olmalıdır." }),
    }),
    symbol: symbolSchema,
    quantity: quantitySchema,
    clientRequestId: clientRequestIdSchema,
  })
  .strict();

export type PlaceOrderBody = z.infer<typeof placeOrderSchema>;

/** Toplu satış öğesi — POST /api/trading/bulk-sell items[] girdisi. */
const bulkSellItemSchema = z
  .object({
    symbol: symbolSchema,
    quantity: quantitySchema,
  })
  .strict();

/**
 * Toplu satış istek gövdesi — POST /api/trading/bulk-sell.
 *
 *  - items: en az 1, en fazla 50 pozisyon (sembol + pozitif tamsayı adet).
 *  - confirmLive: LIVE modda istemcinin onay diyaloğunu geçtiğini kanıtlar;
 *    sunucu tarafında liveModeConfirmedAt damgası da ayrıca zorunludur.
 */
export const bulkSellSchema = z
  .object({
    items: z
      .array(bulkSellItemSchema)
      .min(1, "Toplu satış için en az 1 pozisyon seçilmelidir.")
      .max(50, "Tek istekte en fazla 50 pozisyon satılabilir."),
    confirmLive: z.boolean().optional(),
  })
  .strict();

export type BulkSellBody = z.infer<typeof bulkSellSchema>;

/** Emir geçmişi sorgusu — GET /api/trading/order?page=&pageSize=&side=&status=. */
export const orderHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    side: z.enum(["BUY", "SELL"]).optional(),
    status: z
      .enum([
        "PENDING",
        "EXECUTING",
        "FILLED",
        "REJECTED",
        "FAILED",
        "PENDING_RECONCILIATION",
        "CANCELLED",
      ])
      .optional(),
  })
  .strict();

export type OrderHistoryQuery = z.infer<typeof orderHistoryQuerySchema>;

/** Hesap hareketi sorgusu — GET /api/trading/account?page=&pageSize=. */
export const accountHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type AccountHistoryQuery = z.infer<typeof accountHistoryQuerySchema>;
