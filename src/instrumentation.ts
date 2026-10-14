/**
 * Next.js 15 instrumentation hook — sunucu süreci başlarken bir kez çağrılır.
 *
 * Yalnızca Node.js runtime'ında (NEXT_RUNTIME === "nodejs") otomatik alım-satım
 * scheduler'ı ve BIST 100 senkron zamanlayıcısı başlatılır; Edge runtime ve
 * client bundle'ında asla çalışmaz.
 *
 * Dev hot-reload koruması: scheduler.ts ve bist100-service.ts içindeki
 * globalThis guard'lar tek instance garantisi verir — register() birden
 * fazla kez çağrılsa bile ikinci bir interval açılmaz.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Otomatik scheduler'ları tamamen devre dışı bırakma anahtarı (CI/test).
  if (process.env.AUTO_TRADE_SCHEDULER_DISABLED === "1") {
    console.log(
      "[instrumentation] AUTO_TRADE_SCHEDULER_DISABLED=1 — otomatik scheduler'lar başlatılmadı.",
    );
    return;
  }

  const { startScheduler } = await import("@/server/services/scheduler");
  startScheduler();

  // BIST 100 izleme listesi senkronu — İş Yatırım kaynağından 5 dk'da bir.
  const { startBist100Syncer } = await import(
    "@/server/services/bist100-service"
  );
  startBist100Syncer();
}
