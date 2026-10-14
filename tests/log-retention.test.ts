/**
 * Log retention servisi birim testleri — iyileştirme 3.1.
 *
 * cleanupOldLogs'un retention penceresi hesabını ve tablo kapsamını
 * doğrular. DB'ye dokunmadan saf hesap mantığı test edilir; deleteMany
 * çağrıları prisma client mock'lanır.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Prisma client'ı mock'la — retention servisi prisma'yı modül seviyesinde
// import eder; vi.mock ile sahte bir client enjekte edilir.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiCallLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    aiDecisionLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    aiAnalysisLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    jobRun: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    aiDecisionChat: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

import { cleanupOldLogs, LOG_RETENTION_DAYS } from "@/server/services/log-retention-service";
import { prisma } from "@/lib/prisma";

describe("cleanupOldLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("varsayılan retention penceresi 30 gündür", () => {
    expect(LOG_RETENTION_DAYS).toBe(30);
  });

  it("varsayılan çağrıda 30 gün öncesine göre siler", async () => {
    const before = Date.now();
    await cleanupOldLogs();
    const after = Date.now();

    const calls = (prisma.apiCallLog.deleteMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const where = calls[0]![0].where as { createdAt: { lt: Date } };
    const expectedMin = new Date(before - 30 * 24 * 60 * 60 * 1000).getTime();
    const expectedMax = new Date(after - 30 * 24 * 60 * 60 * 1000).getTime();
    expect(where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("özel gün sayısıyla cutoff ileri/geri kayar", async () => {
    await cleanupOldLogs(7);
    const calls = (prisma.apiCallLog.deleteMany as ReturnType<typeof vi.fn>).mock.calls;
    const where = calls[0]![0].where as { createdAt: { lt: Date } };
    const ageMs = Date.now() - where.createdAt.lt.getTime();
    // 7 gün ± 1 saat tolerans.
    expect(ageMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  });

  it("geçersiz gün sayısı (0, negatif, NaN) varsayılana düşer", async () => {
    await cleanupOldLogs(0);
    await cleanupOldLogs(-5);
    await cleanupOldLogs(Number.NaN);
    const calls = (prisma.apiCallLog.deleteMany as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      const where = call[0].where as { createdAt: { lt: Date } };
      const ageMs = Date.now() - where.createdAt.lt.getTime();
      expect(ageMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(ageMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    }
    expect(calls.length).toBe(3);
  });

  it("beş izleme tablosunun tamamını kapsar", async () => {
    const result = await cleanupOldLogs();
    const tableNames = result.tables.map((t) => t.table);
    expect(tableNames).toEqual([
      "ApiCallLog",
      "AiDecisionLog",
      "AiAnalysisLog",
      "JobRun",
      "AiDecisionChat",
    ]);
  });

  it("JobRun cutoff'u startedAt alanını kullanır", async () => {
    await cleanupOldLogs();
    const calls = (prisma.jobRun.deleteMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    expect(Object.keys(calls[0]![0].where)).toContain("startedAt");
  });

  it("silinen kayıtların toplamı doğru toplanır", async () => {
    (prisma.apiCallLog.deleteMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 3 });
    (prisma.aiDecisionLog.deleteMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 4 });
    const result = await cleanupOldLogs();
    expect(result.totalDeleted).toBe(7);
  });

  it("bir tablo hata verirse diğerleri yine de temizlenir", async () => {
    (prisma.apiCallLog.deleteMany as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("db kilitli"));
    (prisma.aiDecisionLog.deleteMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 2 });
    const result = await cleanupOldLogs();
    // ApiCallLog hata aldı (0 sayıldı) ama AiDecisionLog çalıştı.
    expect(result.tables.find((t) => t.table === "ApiCallLog")?.deleted).toBe(0);
    expect(result.tables.find((t) => t.table === "AiDecisionLog")?.deleted).toBe(2);
    // Beş tablonun da sonucu mevcut — koşu tamamlanır.
    expect(result.tables.length).toBe(5);
  });

  it("sonuçta retentionDays ve ranAt alanları taşınır", async () => {
    const result = await cleanupOldLogs(14);
    expect(result.retentionDays).toBe(14);
    expect(Date.parse(result.ranAt)).not.toBeNaN();
  });
});
