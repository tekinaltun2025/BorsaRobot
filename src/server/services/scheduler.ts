import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAutoTradeCycle } from "@/server/services/auto-trade-service";
import { cleanupOldLogs } from "@/server/services/log-retention-service";

/**
 * Arka plan zamanlayıcısı — otomatik alım-satım döngüsünü periyodik tetikler.
 *
 * Mekanizma:
 *  - startScheduler(): setInterval ile periyodik döngü. Aralık her tick'te
 *    AdminSettings.autoTradeIntervalSeconds'ten TAZE okunur; admin aralığı
 *    değiştirdiğinde bir sonraki tick yeni aralığı uygular (interval yeniden
 *    kurulmaz — tick içinde aralık değişmişse timer resetlenir).
 *  - stopScheduler(): interval temizler (test/teardown).
 *  - globalThis guard: Next.js dev hot-reload sırasında instrumentation
 *    birden fazla kez çalışabilir; tek instance garantisi globalThis üzerinde
 *    tutulur (prisma.ts deseniyle aynı yaklaşım).
 *  - Scheduler yalnızca autoTradingEnabled=true iken döngü ÇALIŞTIRIR;
 *    kapalıysa interval çalışmaya devam eder ama no-op loglar (motor içindeki
 *    guard zaten atlar — burada ekstra log okunabilirliği artırır).
 *
 * Döngü hataları yutulmaz: runAutoTradeCycle kendi hanelerini JobRun'a
 * yazar ve asla fırlatmaz; yine de savunmacik try/catch interval'i korur.
 */

/** Scheduler global durumu — hot-reload'a dayanıklı tek instance. */
interface SchedulerGlobalState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  /** Son tick'te okunan ayar aralığı (sn) — değişim algılama için. */
  lastIntervalSeconds: number;
  /** Son tick zamanı (ISO) — durum kartı için. */
  lastTickAt: string | null;
  /** Son FAILED/uyarılı döngü log imzası — tekrar log spam'ini bastırmak için. */
  lastFailureSignature: string | null;
  /** Aynı imzanın kaç tick'tir tekrarlandığı — "N tick'tir aynı" satırı için. */
  repeatedFailureCount: number;
  /** Son log retention koşusu (ISO) — günde en fazla bir kez tetiklenir. */
  lastRetentionRunAt: string | null;
}

const globalForScheduler = globalThis as unknown as {
  __autoTradeScheduler?: SchedulerGlobalState;
};

function state(): SchedulerGlobalState {
  if (!globalForScheduler.__autoTradeScheduler) {
    globalForScheduler.__autoTradeScheduler = {
      timer: null,
      running: false,
      lastIntervalSeconds: 0,
      lastTickAt: null,
      lastFailureSignature: null,
      repeatedFailureCount: 0,
      lastRetentionRunAt: null,
    };
  }
  return globalForScheduler.__autoTradeScheduler;
}

/** Varsayılan döngü aralığı (sn) — ayar okunamadığında kullanılır. */
const DEFAULT_INTERVAL_SECONDS = 60;

/** Aralığın makul sınırları — bozuk ayara karşı savunma. */
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 3600;

/** Scheduler bu process'te çalışıyor mu? (durum kartı göstergesi). */
export function isSchedulerRunning(): boolean {
  return state().timer !== null;
}

/** Son tick zamanı (ISO) — durum kartı. */
export function getLastTickAt(): string | null {
  return state().lastTickAt;
}

/** Retention'ın günde en fazla bir kez koşması için pencere (ms). */
const RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Çok instance çakışma kilidi (iyileştirme 6.2): tick, çalıştığı DAKİKAYI
 * jobType+startedMinute unique kısıtıyla "claim" eder. İki process (PM2
 * cluster, container replika) aynı dakikada tick atarsa ikincisi P2002
 * alır ve sessizce atlar — farklı cycleId'lerle çift emir üretilmez.
 * Kilit dakika bazlıdır: 60sn aralıklı tek instance normal akışta her
 * dakikada yeni claim alır; 30sn aralıkta aynı dakikadaki ikinci tick
 * atlanır (döngü zaten koşmuştur — istenen davranış).
 */
const SCHEDULER_LOCK_JOB_TYPE = "SCHEDULER_TICK_LOCK";

async function claimTickLock(): Promise<boolean> {
  const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  try {
    await prisma.jobRun.create({
      data: {
        jobType: `${SCHEDULER_LOCK_JOB_TYPE}:${minute}`,
        status: "SUCCESS",
        startedAt: new Date(),
        finishedAt: new Date(),
        processedCount: 0,
        resultSummary: JSON.stringify({ lock: true, minute }),
      },
    });
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false; // Başka instance bu dakikayı aldı.
    }
    // Kilit tablosu erişilemezse kilitleme YAPILMAZ (fail-open): tek
    // instance kurulumlarında DB arızası döngüyü durdurmamalı.
    return true;
  }
}

/**
 * Günlük log retention koşusu — son koşudan 24 saat geçtiyse tetiklenir.
 * Hata yutulmaz ama interval'i de kırmaz: loglanır, sonraki gün tekrar denenir.
 */
async function maybeRunRetention(): Promise<void> {
  const s = state();
  const lastRun = s.lastRetentionRunAt ? Date.parse(s.lastRetentionRunAt) : 0;
  if (Number.isFinite(lastRun) && Date.now() - lastRun < RETENTION_MIN_INTERVAL_MS) {
    return;
  }
  s.lastRetentionRunAt = new Date().toISOString();
  try {
    const result = await cleanupOldLogs();
    if (result.totalDeleted > 0) {
      const perTable = result.tables
        .map((t) => `${t.table}=${t.deleted}`)
        .join(", ");
      console.log(
        `[log-retention] ${result.retentionDays} günden eski ${result.totalDeleted} kayıt silindi (${perTable}).`,
      );
    }
  } catch (error: unknown) {
    console.error("[log-retention] Temizlik koşusu başarısız:", error);
  }
}

/**
 * Tek bir scheduler tick'i: ayarları okur, koşul uygunsa döngüyü çalıştırır,
 * aralık değişmişse timer'ı yeni aralığa resetler.
 */
async function tick(): Promise<void> {
  const s = state();
  s.lastTickAt = new Date().toISOString();

  // Günlük log retention (iyileştirme 3.1) — döngü kapalı olsa bile koşar;
  // log tablolarının sınırsız büyümesi bağımsız bir operasyon sorunudur.
  await maybeRunRetention();

  try {
    const settings = await prisma.adminSettings.findUnique({
      where: { id: "singleton" },
      select: {
        autoTradingEnabled: true,
        autoTradeIntervalSeconds: true,
        tradingMode: true,
      },
    });

    // Aralık değişimi: timer'ı yeni aralığa resetle (tick yeniden planlanır).
    const intervalSeconds = clampInterval(
      settings?.autoTradeIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
    );
    if (intervalSeconds !== s.lastIntervalSeconds) {
      s.lastIntervalSeconds = intervalSeconds;
      restartTimer();
    }

    if (!settings?.autoTradingEnabled) {
      console.log(
        "[auto-trade scheduler] Otomatik ticaret kapalı — döngü atlandı (no-op).",
      );
      return;
    }

    if (settings.tradingMode !== "PAPER") {
      console.log(
        "[auto-trade scheduler] tradingMode=PAPER değil — otomatik döngü güvenlik gereği atlandı.",
      );
      return;
    }

    // Çok instance kilidi (iyileştirme 6.2): bu dakika başka bir process
    // tarafından claim edilmişse döngü koşmaz (çift emir koruması).
    if (!(await claimTickLock())) {
      console.log(
        "[auto-trade scheduler] Bu dakikanın tick'i başka bir instance tarafından alındı — atlandı.",
      );
      return;
    }

    const result = await runAutoTradeCycle();
    const { summary } = result;

    // Durum-farkındalıklı log: FAILED/uyarılı döngülerde aynı imza tekrar
    // ediyorsa tam satır yalnızca İLK SEFERDE basılır; sonraki tick'lerde
    // kısa "N tick'tir aynı" satırı düşer — terminal spam'i önlenir.
    // İmza: durum + hata/uyarı mesajları (süre/pozisyon gibi değişken
    // alanlar imzaya dahil edilmez; aynı kök neden tek imzada toplanır).
    const failureSignature =
      result.status === "FAILED" || summary.warnings.length > 0
        ? JSON.stringify([result.status, summary.errors, summary.warnings])
        : null;

    if (failureSignature === null) {
      // Temiz döngü: her zaman tam log + tekrar sayacını sıfırla.
      s.lastFailureSignature = null;
      s.repeatedFailureCount = 0;
      console.log(
        `[auto-trade scheduler] Döngü ${result.status} (${result.durationMs}ms): ` +
          `pozisyon=${summary.positionsChecked}, analiz=${summary.analysesRun}, ` +
          `emir=${summary.ordersPlaced} (FILLED=${summary.ordersFilled}), ` +
          `hata=${summary.errors.length}` +
          (summary.skipped ? ` — atlandı: ${summary.skipReason ?? ""}` : ""),
      );
    } else if (failureSignature === s.lastFailureSignature) {
      // Aynı kök neden tekrar ediyor: kısa hatırlatma satırı.
      s.repeatedFailureCount += 1;
      console.log(
        `[auto-trade scheduler] Döngü ${result.status} — aynı durum ${s.repeatedFailureCount} tick'tir sürüyor ` +
          `(hata=${summary.errors.length}, uyarı=${summary.warnings.length}); detay için önceki log'a bakın.`,
      );
    } else {
      // Yeni kök neden: tam detaylı log (hata + uyarı mesajları dahil).
      s.lastFailureSignature = failureSignature;
      s.repeatedFailureCount = 0;
      const warningText =
        summary.warnings.length > 0
          ? `, uyarı=${summary.warnings.length} (ilk: ${summary.warnings[0]})`
          : "";
      console.log(
        `[auto-trade scheduler] Döngü ${result.status} (${result.durationMs}ms): ` +
          `pozisyon=${summary.positionsChecked}, analiz=${summary.analysesRun}, ` +
          `emir=${summary.ordersPlaced} (FILLED=${summary.ordersFilled}), ` +
          `hata=${summary.errors.length}${warningText}` +
          (summary.skipped ? ` — atlandı: ${summary.skipReason ?? ""}` : ""),
      );
      for (const error of summary.errors) {
        console.error(`[auto-trade scheduler]   ↳ hata: ${error}`);
      }
      for (const warning of summary.warnings) {
        console.warn(`[auto-trade scheduler]   ↳ uyarı: ${warning}`);
      }
    }
  } catch (error: unknown) {
    // Interval asla kırılmaz: hata loglanır, sonraki tick denemeye devam eder.
    console.error(
      "[auto-trade scheduler] Tick hatası:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Ayar aralığını güvenli sınırlara sıkıştırır. */
function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) {
    return MIN_INTERVAL_SECONDS;
  }
  if (seconds > MAX_INTERVAL_SECONDS) return MAX_INTERVAL_SECONDS;
  return Math.floor(seconds);
}

/** Mevcut timer'ı temizleyip son bilinen aralıkla yeniden kurar. */
function restartTimer(): void {
  const s = state();
  if (s.timer !== null) {
    clearInterval(s.timer);
    s.timer = null;
  }
  const intervalSeconds =
    s.lastIntervalSeconds > 0
      ? s.lastIntervalSeconds
      : DEFAULT_INTERVAL_SECONDS;
  s.timer = setInterval(() => {
    void tick();
  }, intervalSeconds * 1000);
}

/**
 * Scheduler'ı başlatır — Next.js instrumentation.ts register() içinden
 * çağrılır (yalnızca process.env.NEXT_RUNTIME === "nodejs" iken).
 *
 * Idempotent: zaten çalışıyorsa hiçbir şey yapmaz (hot-reload guard).
 */
export function startScheduler(): void {
  const s = state();
  if (s.timer !== null) {
    console.log("[auto-trade scheduler] Zaten çalışıyor — yeni instance açılmadı.");
    return;
  }
  s.lastIntervalSeconds = DEFAULT_INTERVAL_SECONDS;
  s.timer = setInterval(() => {
    void tick();
  }, DEFAULT_INTERVAL_SECONDS * 1000);
  console.log(
    `[auto-trade scheduler] Başlatıldı (varsayılan aralık ${DEFAULT_INTERVAL_SECONDS}sn; ` +
      "ayar aralığı ilk tick'te taze okunur).",
  );
}

/** Scheduler'ı durdurur — test/teardown amaçlı. */
export function stopScheduler(): void {
  const s = state();
  if (s.timer !== null) {
    clearInterval(s.timer);
    s.timer = null;
    console.log("[auto-trade scheduler] Durduruldu.");
  }
}
