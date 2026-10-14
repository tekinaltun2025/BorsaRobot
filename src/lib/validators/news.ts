import { z } from "zod";

/**
 * Haber tarama Zod şemaları — RSS parse çıktısı dahil tüm dış veriler
 * doğrulanır (kalite standardı: dış API yanıtları Zod'suz işlenmez).
 */

/**
 * Google News RSS <item> ham çıktısı — fast-xml-parser parse sonrası yapı.
 *
 * source etiketi iki biçimde gelir:
 *  - string (attribute'suz nadir durum)
 *  - { "#text": "Kaynak Adı", "@_url": "https://..." } (normal durum)
 */
export const googleNewsRssItemSchema = z.object({
  title: z.string().min(1),
  link: z.string().min(1),
  pubDate: z.string().optional(),
  description: z.union([z.string(), z.number(), z.null()]).optional(),
  source: z.unknown().optional(),
});

/** Normalize edilmiş haber öğesi — NewsService'e giren tek biçim. */
export const rawNewsItemSchema = z.object({
  /** Haber başlığı (boş olamaz). */
  title: z.string().min(1).max(500),
  /** Haber özeti (boş olabilir). */
  summary: z.string().max(8000),
  /** Haber URL'i — dedup anahtarının kaynağı. */
  url: z.string().min(1).max(2000),
  /** Kaynak adı (örn. "NTV"). */
  source: z.string().min(1).max(200),
  /** Yayın tarihi. */
  publishedAt: z.date(),
});

export type RawNewsItem = z.infer<typeof rawNewsItemSchema>;

/** Haber listesi API yanıtı öğesi — GET /api/news. */
export const newsArticleViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  source: z.string(),
  publishedAt: z.string(),
  importanceLevel: z.string().optional(),
});

export type NewsArticleView = z.infer<typeof newsArticleViewSchema>;
