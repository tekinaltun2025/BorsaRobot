import { prisma } from "@/lib/prisma";

/**
 * Log retention servisi — iyileştirme 3.1.
 *
 * ApiCallLog, AiDecisionLog, AiAnalysisLog, JobRun ve AiDecisionChat tabloları
 * sınırsız büyür; SQLite dosyası haftalar içinde onlarca GB'a ulaşabilir ve
 * sorgular yavaşlar. Bu servis belirtilen retention penceresinden eski
 * kayıtları toplu siler.
 *
 * Tetikleme: scheduler her tick'te "son temizlik 24 saatten eski mi?"
 * kontrol eder; öyleyse bu servisi çağırır (günde en fazla bir kez).
 *
 * Silme işlemi idempotent ve güvenlidir:
 *  - AiAnalysisLog silinirse Order.analysisLogId FK'si ON DELETE SET NULL'dır.
 *  - AiDecisionLog.jobRunId düz metin alanıdır (FK değildir) — yalnız kaybolur.
 *  - Emir/pozisyon/bakiye verilerine (Order, Portfolio, AccountTransaction)
 *    ASLA dokunulmaz — yalnızca izleme kayıtları temizlenir.
 */

/** Varsayılan retention penceresi (gün). */
export const LOG_RETENTION_DAYS = 30;

/** Tek bir tablonun temizlik sonucu. */
export interface RetentionTableResult {
  /** Temizlenen tablo adı. */
  table: string;
  /** Silinen kayıt sayısı. */
  deleted: number;
}

/** Temizlik koşusunun toplam sonucu. */
export interface RetentionRunResult {
  /** Temizliğin çalıştığı an (ISO). */
  ranAt: string;
  /** Retention penceresi (gün). */
  retentionDays: number;
  /** Tablo bazlı sonuçlar. */
  tables: RetentionTableResult[];
  /** Toplam silinen kayıt sayısı. */
  totalDeleted: number;
}

/**
 * Retention penceresinden eski izleme kayıtlarını siler.
 *
 * @param days Retention penceresi (gün) — varsayılan 30. Test/operasyon
 *             amaçlıyla küçültülebilir; 0 veya negatif değer varsayılana düşer.
 */
export async function cleanupOldLogs(
  days: number = LOG_RETENTION_DAYS,
): Promise<RetentionRunResult> {
  const retentionDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : LOG_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // deleteMany çağrıları bağımsızdır: bir tablo silinemediğinde (kilit vb.)
  // diğerleri yine de temizlenir; hata durumunda çağıran loglar.
  const tables: RetentionTableResult[] = [];

  try {
    const apiCallLogs = await prisma.apiCallLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    tables.push({ table: "ApiCallLog", deleted: apiCallLogs.count });
  } catch (error: unknown) {
    console.error("[log-retention] ApiCallLog temizliği başarısız:", error);
    tables.push({ table: "ApiCallLog", deleted: 0 });
  }

  try {
    const aiDecisionLogs = await prisma.aiDecisionLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    tables.push({ table: "AiDecisionLog", deleted: aiDecisionLogs.count });
  } catch (error: unknown) {
    console.error("[log-retention] AiDecisionLog temizliği başarısız:", error);
    tables.push({ table: "AiDecisionLog", deleted: 0 });
  }

  try {
    const aiAnalysisLogs = await prisma.aiAnalysisLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    tables.push({ table: "AiAnalysisLog", deleted: aiAnalysisLogs.count });
  } catch (error: unknown) {
    console.error("[log-retention] AiAnalysisLog temizliği başarısız:", error);
    tables.push({ table: "AiAnalysisLog", deleted: 0 });
  }

  try {
    const jobRuns = await prisma.jobRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    tables.push({ table: "JobRun", deleted: jobRuns.count });
  } catch (error: unknown) {
    console.error("[log-retention] JobRun temizliği başarısız:", error);
    tables.push({ table: "JobRun", deleted: 0 });
  }

  try {
    const chatMessages = await prisma.aiDecisionChat.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    tables.push({ table: "AiDecisionChat", deleted: chatMessages.count });
  } catch (error: unknown) {
    console.error("[log-retention] AiDecisionChat temizliği başarısız:", error);
    tables.push({ table: "AiDecisionChat", deleted: 0 });
  }

  const totalDeleted = tables.reduce((sum, t) => sum + t.deleted, 0);

  return {
    ranAt: new Date().toISOString(),
    retentionDays,
    tables,
    totalDeleted,
  };
}
