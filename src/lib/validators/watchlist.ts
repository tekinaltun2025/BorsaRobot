import { z } from "zod";

/**
 * İzleme listesi API doğrulama şemaları — /api/watchlist ve
 * /api/market/* gövdelerini/sorgularını doğrular.
 *
 * Hatalar Zod flatten çıktısıyla API katmanına düşer; API katmanı bunları
 * 422 + TR mesajla döner (trading.ts sözleşmesiyle uyumlu).
 */

/**
 * BIST sembol formatı: 3–5 harf (görev tanımı).
 * trading.ts'teki 3-6 varyanttan farklı olarak izleme listesi ekleme
 * girişi daha sıkıdır; mevcut 6 harfli semboller listelemede sorunsuz okunur.
 */
const watchlistSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,5}$/, "Sembol 3–5 harf olmalıdır (örn. THYAO).");

/** POST /api/watchlist gövdesi — { symbol, name?, sector? }. */
export const addToWatchlistSchema = z
  .object({
    symbol: watchlistSymbolSchema,
    name: z
      .string()
      .trim()
      .min(2, "Hisse adı en az 2 karakter olmalıdır.")
      .max(120, "Hisse adı en fazla 120 karakter olabilir.")
      .optional(),
    sector: z
      .string()
      .trim()
      .min(2, "Sektör adı en az 2 karakter olmalıdır.")
      .max(80, "Sektör adı en fazla 80 karakter olabilir.")
      .optional(),
  })
  .strict();

export type AddToWatchlistBody = z.infer<typeof addToWatchlistSchema>;

/** DELETE /api/watchlist gövdesi — { symbol }. */
export const removeFromWatchlistSchema = z
  .object({
    symbol: watchlistSymbolSchema,
  })
  .strict();

export type RemoveFromWatchlistBody = z.infer<typeof removeFromWatchlistSchema>;

/** GET /api/market/history sorgusu — ?symbol=XXX&range=1D|1W|1M|3M|1Y. */
export const historyQuerySchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3,6}$/, "Sembol 3–6 harf olmalıdır (örn. THYAO)."),
    range: z
      .enum(["1D", "1W", "1M", "3M", "1Y"], {
        errorMap: () => ({
          message: "Dönem 1D, 1W, 1M, 3M veya 1Y olmalıdır.",
        }),
      })
      .default("1D"),
  })
  .strict();

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** POST /api/market/tick gövdesi — opsiyonel { seed?, symbols? } (dev/test). */
export const marketTickSchema = z
  .object({
    seed: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
    symbols: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3,6}$/, "Semboller 3–6 harf olmalıdır."),
      )
      .max(50, "En fazla 50 sembol işlenebilir.")
      .optional(),
  })
  .strict();

export type MarketTickBody = z.infer<typeof marketTickSchema>;
