import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { rawNewsItemSchema, type RawNewsItem } from "@/lib/validators/news";

/**
 * Google News RSS scraper'ı — INewsScraper sözleşmesi (Bölüm 4.9).
 *
 * Kaynak: https://news.google.com/rss/search?q=...&hl=tr&gl=TR&ceid=TR:tr
 * API key GEREKTİRMEZ — ücretsiz, açık RSS uç noktası.
 *
 * Davranış sözleşmesi:
 *  - Sorgu: hisse adı + sembol (örn. "THYAO Türk Hava Yolları").
 *  - XML parse: fast-xml-parser; çıktı Zod ile doğrulanır.
 *  - Network hatalarına dayanıklı: 10 sn timeout (AbortController),
 *    hata durumunda boş liste + log — asla crash yok.
 *  - Dedup scraper'da DEĞİLDİR; NewsService urlHash ile uygular.
 */

/** RSS fetch timeout'u (ms). */
const RSS_TIMEOUT_MS = 10_000;

/** Tek taramada işlenecek maksimum makale sayısı. */
const MAX_ARTICLES_PER_SCAN = 20;

/** Google News RSS arama URL'ini kurar. */
export function buildGoogleNewsRssUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: "tr",
    gl: "TR",
    ceid: "TR:tr",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/** RSS <item> şeması — fast-xml-parser çıktısının ham hali. */
const rssItemSchema = z.object({
  title: z.string().min(1),
  link: z.string().min(1),
  pubDate: z.string().optional(),
  description: z.union([z.string(), z.number(), z.null()]).optional(),
  source: z.unknown().optional(),
});

/** source etiketi iki biçimde gelir: string veya { "#text": ad, "@_url": url }. */
function extractSourceName(source: unknown): string {
  if (typeof source === "string" && source.trim()) {
    return source.trim().slice(0, 200);
  }
  if (source !== null && typeof source === "object") {
    const record = source as Record<string, unknown>;
    const text = record["#text"];
    if (typeof text === "string" && text.trim()) {
      return text.trim().slice(0, 200);
    }
  }
  return "Google News";
}

/** pubDate'i Date'e çevirir; geçersizse şimdi. */
function parsePubDate(pubDate: string | undefined): Date {
  if (!pubDate) return new Date();
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** description alanını güvenli metne çevirir (HTML tag'leri soyulur). */
function cleanDescription(description: string | number | null | undefined): string {
  if (description === null || description === undefined) return "";
  const text = String(description);
  // Basit HTML tag temizliği + HTML entity çözümü (RSS özetleri HTML içerir).
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

/**
 * Ham RSS XML metnini RawNewsItem listesine çevirir.
 * Zod doğrulaması: şema dışı item'lar sessizce atlanır (kısmi veri kaybı
 * tam tarama hatasından iyidir).
 */
export function parseGoogleNewsRss(xml: string): RawNewsItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error: unknown) {
    console.error("[google-news] XML parse hatası:", error);
    return [];
  }

  // RSS zarfı: rss > channel > item[]
  const channel = (parsed as Record<string, unknown>)?.["rss"];
  const channelRecord = channel as Record<string, unknown> | undefined;
  const channelInner = channelRecord?.["channel"] as Record<string, unknown> | undefined;
  const items = channelInner?.["item"];

  if (items === undefined || items === null) return [];
  const itemArray = Array.isArray(items) ? items : [items];

  const results: RawNewsItem[] = [];
  for (const rawItem of itemArray) {
    const itemCheck = rssItemSchema.safeParse(rawItem);
    if (!itemCheck.success) continue;

    const item = itemCheck.data;
    const normalized = rawNewsItemSchema.safeParse({
      title: item.title.trim().slice(0, 500),
      summary: cleanDescription(item.description),
      url: item.link.trim(),
      source: extractSourceName(item.source),
      publishedAt: parsePubDate(item.pubDate),
    });
    if (normalized.success) {
      results.push(normalized.data);
    }
    if (results.length >= MAX_ARTICLES_PER_SCAN) break;
  }
  return results;
}

/**
 * Belirtilen hisse için Google News RSS taraması yapar.
 *
 * @param symbol BIST sembolü (örn. "THYAO").
 * @param stockName Şirket tam adı — sorgu zenginleştirmesi.
 * @returns Normalize edilmiş haber listesi; hata durumunda boş liste.
 */
export async function fetchGoogleNews(
  symbol: string,
  stockName: string,
): Promise<RawNewsItem[]> {
  const query = `${symbol} ${stockName}`.trim();
  const url = buildGoogleNewsRssUrl(query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Google News bazı istemcileri reddeder; tanımlı UA gerekli.
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[google-news] RSS isteği başarısız: HTTP ${response.status} (${symbol})`,
      );
      return [];
    }

    const xml = await response.text();
    return parseGoogleNewsRss(xml);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[google-news] RSS timeout (${RSS_TIMEOUT_MS / 1000}sn): ${symbol}`);
    } else {
      console.error(`[google-news] RSS ağ hatası (${symbol}):`, error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * URL'in SHA-256 hash'i — NewsArticle.urlHash dedup anahtarı.
 *
 * Global Web Crypto API (crypto.subtle) kullanır — Node.js 18+ üzerinde
 * global olarak mevcuttur ve Webpack bundle'ında modül çözümü gerektirmez.
 * Çıktı, node:crypto createHash("sha256") ile birebir aynı hex değeridir;
 * mevcut urlHash kayıtlarıyla uyum korunur.
 */
export async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url.trim());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
