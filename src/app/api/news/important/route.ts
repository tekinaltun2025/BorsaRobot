import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/news/important?limit=20
 * Tüm hisseler genelinde IMPORTANT ve CRITICAL önem derecesindeki haberleri getirir.
 * Tarih sıralı (yeniden eskiye), limit ile sınırlı.
 *
 * Yanıt:
 * {
 *   important: NewsArticleView[],
 *   critical: NewsArticleView[],
 *   fetchedAt: string
 * }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));

  try {
    const [important, critical] = await Promise.all([
      prisma.newsArticle.findMany({
        where: { importanceLevel: "IMPORTANT" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          summary: true,
          url: true,
          source: true,
          publishedAt: true,
          importanceLevel: true,
          stock: { select: { symbol: true, name: true } },
        },
      }),
      prisma.newsArticle.findMany({
        where: { importanceLevel: "CRITICAL" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          summary: true,
          url: true,
          source: true,
          publishedAt: true,
          importanceLevel: true,
          stock: { select: { symbol: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      important: important.map((a) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt.toISOString(),
        importanceLevel: a.importanceLevel,
        symbol: a.stock?.symbol ?? "GENEL",
        stockName: a.stock?.name ?? "Genel Piyasa",
      })),
      critical: critical.map((a) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt.toISOString(),
        importanceLevel: a.importanceLevel,
        symbol: a.stock?.symbol ?? "GENEL",
        stockName: a.stock?.name ?? "Genel Piyasa",
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[news/important GET] Hata:", error);
    return NextResponse.json(
      { error: "Önemli haberler yüklenirken hata oluştu." },
      { status: 500 },
    );
  }
}