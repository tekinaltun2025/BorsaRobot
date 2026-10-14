import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSchedulerRunning, getLastTickAt } from "@/server/services/scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — sağlık durumu (iyileştirme 6.1).
 *
 * Yanıt (200 — kısmi arıza bile 200; durum alanları taşır):
 *  - status: "ok" (DB erişilebilir) | "degraded" (DB erişilemez)
 *  - checks.database: DB ping sonucu + gecikme (ms)
 *  - checks.scheduler: bu process'te scheduler çalışıyor mu + son tick
 *  - checks.lastJobRun: son otomatik döngü kaydının durumu (varsa)
 *  - uptimeSeconds / timestamp: process uptime ve anlık zaman
 *
 * Not: bu endpoint kasıtlı olarak auth GEREKTİRMEZ (uptime izleyicileri
 * — UptimeRobot vb. — cookie auth'u geçemez); yalnızka toplam durum
 * gösterir, hassas veri (bakiye, anahtar, emir) içermez.
 */
export async function GET() {
  const startedAt = Date.now();
  const checks: {
    database: { ok: boolean; latencyMs: number | null; error?: string };
    scheduler: { running: boolean; lastTickAt: string | null };
    lastJobRun: {
      jobType: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
    } | null;
  } = {
    database: { ok: false, latencyMs: null },
    scheduler: { running: isSchedulerRunning(), lastTickAt: getLastTickAt() },
    lastJobRun: null,
  };

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - dbStart };

    const lastRun = await prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { jobType: true, status: true, startedAt: true, finishedAt: true },
    });
    if (lastRun) {
      checks.lastJobRun = {
        jobType: lastRun.jobType,
        status: lastRun.status,
        startedAt: lastRun.startedAt.toISOString(),
        finishedAt: lastRun.finishedAt ? lastRun.finishedAt.toISOString() : null,
      };
    }
  } catch (error: unknown) {
    checks.database = {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return NextResponse.json({
    status: checks.database.ok ? "ok" : "degraded",
    checks,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    responseMs: Date.now() - startedAt,
  });
}
