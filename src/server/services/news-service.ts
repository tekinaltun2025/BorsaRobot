import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/app-error";
import type { NewsArticle } from "@prisma/client";
import type { NewsArticleView } from "@/lib/validators/news";
import { fetchGoogleNews, hashUrl } from "@/server/providers/google-news-scraper";
import { resolveLlmProvider } from "@/server/providers/llm-provider-factory";
import { parseAndValidate } from "@/server/services/llm-response-parser";
import { z } from "zod";
import { getAdminSettings } from "@/server/services/settings-service";

/** Haber önem analizi şeması. */
const newsImportanceSchema = z.object({
  importanceLevel: z.enum(["IMPORTANT", "CRITICAL"]),
  impactReasoning: z.string().max(500),
});

type NewsImportanceResult = z.infer<typeof newsImportanceSchema>;

/**
 * Haber servisi — NewsArticle kayıtlarının tek sahibi (Bölüm 3.1 NewsService).
 *
 * Sorumluluklar:
 *  - Sembol bazlı haber taraması (Google News RSS — API key gerektirmez).
 *  - Dedup: urlHash (SHA-256) unique kontrolü — aynı URL iki kez KAYDEDİLMEZ.
 *  - NewsArticle kayıtları oluşturma (başlık, özet, url, kaynak, tarih, sembol).
 *  - Sembol bazlı makale listesi (sayfalama, tarih sıralı).
 *
 * Hata politikası: tarama hatası BOŞ SONUÇ + log döndürür; asla crash yok.
 */

/** Kullanıcıya dönük iş kuralı ihlali — API katmanı 4xx'e map eder. */
export class NewsServiceError extends AppError {
  constructor(
    message: string,
    code: "NOT_FOUND" | "VALIDATION",
    httpStatus: number = 400,
  ) {
    super(message, code, httpStatus);
  }
}

/** Tarama sonucu özeti — POST /api/news/scan yanıtı. */
export interface NewsScanResult {
  /** Sembol. */
  symbol: string;
  /** Kaynaktan gelen toplam makale sayısı (dedup öncesi). */
  fetched: number;
  /** Yeni kaydedilen makale sayısı (dedup sonrası). */
  inserted: number;
  /** Zaten mevcut olan (tekrar eden) makale sayısı. */
  duplicates: number;
  /** Tarama anı (ISO). */
  scannedAt: string;
}

/**
 * Sembol için haber taraması çalıştırır ve yeni makaleleri kaydeder.
 *
 * Akış (iyileştirme 5.5 — tek tek INSERT yerine toplu kayıt):
 *  1. Stock kaydı doğrulanır (yoksa NOT_FOUND).
 *  2. Google News RSS çekilir (hata → boş liste, log).
 *  3. Tüm makalelerin urlHash'i paralel hesaplanır; aynı tarama içindeki
 *     çift URL'ler ve DB'de zaten kayıtlı hash'ler elenir (tek sorgu).
 *  4. Yeni makaleler createMany ile TEK sorguda eklenir.
 */
export async function scanNewsForStock(symbol: string): Promise<NewsScanResult> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new NewsServiceError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const items = await fetchGoogleNews(stock.symbol, stock.name);
  if (items.length === 0) {
    return {
      symbol: stock.symbol,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      scannedAt: new Date().toISOString(),
    };
  }

  // Hash'leri paralel hesapla (CPU-bağlı SHA-256, makale başına bağımsız).
  const hashed = await Promise.all(
    items.map(async (item) => ({
      item,
      urlHash: await hashUrl(item.url),
    })),
  );

  // Aynı tarama içindeki çift URL'leri ele (ilk görülen kalır).
  const seenInBatch = new Set<string>();
  const unique = hashed.filter(({ urlHash }) => {
    if (seenInBatch.has(urlHash)) return false;
    seenInBatch.add(urlHash);
    return true;
  });

  // DB'de zaten kayıtlı hash'ler tek sorguda çekilir (SQLite'ta
  // createMany skipDuplicates desteklemez; set karşılaştırması yeterli).
  const candidateHashes = unique.map(({ urlHash }) => urlHash);
  const existingRows = await prisma.newsArticle.findMany({
    where: { urlHash: { in: candidateHashes } },
    select: { urlHash: true },
  });
  const existingHashes = new Set(existingRows.map((row) => row.urlHash));

  const fresh = unique.filter(({ urlHash }) => !existingHashes.has(urlHash));
  const duplicates = items.length - fresh.length;

  if (fresh.length > 0) {
    let inserted = 0;
    // LLM analizi için ayarları alalım.
    const settings = await getAdminSettings();

    // Yeni makaleleri tek tek işleyelim (LLM analizi gereği createMany yerine loop).
    for (const { item, urlHash } of fresh) {
      try {
        let importanceLevel: string | undefined = undefined;
        let impactReasoning: string | undefined = undefined;

        // LLM ile önem derecesi analizi.
        try {
          const llmProvider = await resolveLlmProvider();
          const prompt = `Haber içeriğini analiz et ve önem derecesini belirle.\n\nBaşlık: ${item.title}\nÖzet: ${item.summary}`;
          const result = await llmProvider.generateStructured(prompt, settings.newsScanPrompt);
          const parsed = parseAndValidate(result, newsImportanceSchema);

          importanceLevel = parsed.importanceLevel;
          impactReasoning = parsed.impactReasoning;
        } catch (llmError) {
          console.warn(`[NewsService] LLM analizi başarısız (${item.title}):`, llmError);
          // Analiz başarısız olursa varsayılan olarak null bırakıyoruz, akış bozulmasın.
        }

        await prisma.newsArticle.create({
          data: {
            title: item.title,
            summary: item.summary,
            url: item.url,
            urlHash,
            source: item.source,
            publishedAt: item.publishedAt,
            stockId: stock.id,
            importanceLevel,
            impactReasoning,
          },
        });
        inserted++;
      } catch (error) {
        console.error(`[NewsService] Makale kaydedilemedi (${item.title}):`, error);
        // Hata durumunda döngü devam etmeli.
      }
    }

    return {
      symbol: stock.symbol,
      fetched: items.length,
      inserted,
      duplicates: items.length - inserted,
      scannedAt: new Date().toISOString(),
    };
  }

  return {
    symbol: stock.symbol,
    fetched: items.length,
    inserted: fresh.length,
    duplicates,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Sembolün makale listesi — GET /api/news.
 *
 * @param symbol  BIST sembolü.
 * @param page    1-tabanlı sayfa numarası.
 * @param pageSize Sayfa boyutu (varsayılan 10, maks 50).
 */
export async function listNewsForStock(
  symbol: string,
  page: number = 1,
  pageSize: number = 10,
): Promise<{ articles: NewsArticleView[]; total: number; page: number; pageSize: number }> {
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  if (!stock) {
    throw new NewsServiceError(
      `"${symbol}" sembollü hisse bulunamadı.`,
      "NOT_FOUND",
      404,
    );
  }

  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));

  const [articles, total] = await Promise.all([
    prisma.newsArticle.findMany({
      where: { stockId: stock.id },
      orderBy: { publishedAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.newsArticle.count({ where: { stockId: stock.id } }),
  ]);

  return {
    articles: articles.map((a: NewsArticle) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt.toISOString(),
      importanceLevel: a.importanceLevel ?? undefined,
    })),
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * Analiz girdisi için son N makale — analysis-service'in okuma portu.
 * Yeniden eskiye tarih sıralı; özet ve önem derecesi prompta taşınır.
 */
export async function getRecentNewsForAnalysis(
  stockId: string,
  limit: number = 10,
): Promise<{ title: string; summary: string; publishedAt: Date; source: string; id: string; importanceLevel?: string | null; impactReasoning?: string | null }[]> {
  const articles = await prisma.newsArticle.findMany({
    where: { stockId },
    orderBy: { publishedAt: "desc" },
    take: Math.min(20, Math.max(1, limit)),
    select: {
      id: true,
      title: true,
      summary: true,
      publishedAt: true,
      source: true,
      importanceLevel: true,
      impactReasoning: true,
    },
  });
  return articles;
}
