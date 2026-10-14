import { Bot, Clock3, PauseCircle, Timer } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { AutoTradeStatusView } from "@/server/services/auto-trade-service";

/**
 * Otomatik alım-satım motoru durum kartı (Faz 5) — /trading sayfası.
 *
 * Statik görünümdür (server component'te render edilir): motor anahtarı,
 * döngü aralığı, zamanlayıcı durumu, son döngü zamanı ve özeti gösterir.
 * Kontrol (aç/kapa, şimdi çalıştır) admin panelindeki Otomatik Ticaret
 * bölümündedir; burada yalnızca durum izlenir.
 */
export function AutoTradeStatusCard({ status }: { status: AutoTradeStatusView }) {
  const lastRun = status.lastRun;
  const summary = lastRun?.summary ?? null;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={status.enabled ? "text-purple-400" : "text-gray-600"}
            aria-hidden
          >
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Otomatik Alım-Satım Motoru</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <Timer className="h-3 w-3" aria-hidden />
                Döngü aralığı: {status.intervalSeconds} sn
              </span>
              <span>
                Zamanlayıcı:{" "}
                {status.schedulerRunning ? (
                  <span className="text-emerald-400">aktif</span>
                ) : (
                  <span className="text-gray-400">kapalı</span>
                )}
              </span>
            </p>
          </div>
        </div>

        <span
          className={
            status.enabled
              ? "inline-flex items-center gap-1 rounded-full border border-emerald-700 bg-emerald-950 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
              : "inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400"
          }
        >
          {status.enabled ? (
            <Bot className="h-3 w-3" aria-hidden />
          ) : (
            <PauseCircle className="h-3 w-3" aria-hidden />
          )}
          {status.enabled ? "Etkin" : "Devre Dışı"}
        </span>
      </div>

      <div className="mt-4 border-t border-gray-800 pt-4">
        {lastRun === null ? (
          <p className="text-xs text-gray-500">
            Henüz otomatik döngü çalışmadı. Motoru admin panelinden
            etkinleştirdiğinizde döngüler burada görünür.
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
              <Clock3 className="h-3 w-3 text-gray-500" aria-hidden />
              <span>Son döngü: {formatDate(lastRun.startedAt)}</span>
              <span
                className={
                  lastRun.status === "SUCCESS"
                    ? "font-medium text-emerald-400"
                    : lastRun.status === "FAILED"
                      ? "font-medium text-rose-400"
                      : "font-medium text-amber-400"
                }
              >
                {lastRun.status === "SUCCESS"
                  ? "başarılı"
                  : lastRun.status === "FAILED"
                    ? "başarısız"
                    : "çalışıyor"}
              </span>
              {lastRun.durationMs !== null ? (
                <span className="text-gray-500">({lastRun.durationMs} ms)</span>
              ) : null}
            </p>

            {summary !== null ? (
              summary.skipped ? (
                <p className="text-xs text-gray-500">
                  Döngü atlandı: {summary.skipReason ?? "neden bilinmiyor"}
                </p>
              ) : (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
                  <span>Pozisyon: {summary.positionsChecked}</span>
                  <span className="text-rose-400">SL: {summary.stopLossTriggered}</span>
                  <span className="text-emerald-400">TP: {summary.takeProfitTriggered}</span>
                  <span>Analiz: {summary.analysesRun}</span>
                  <span>
                    Emir: {summary.ordersPlaced} (gerçekleşen {summary.ordersFilled}
                    {summary.ordersRejected > 0
                      ? `, reddedilen ${summary.ordersRejected}`
                      : ""}
                    )
                  </span>
                  {summary.errors.length > 0 ? (
                    <span className="text-rose-400">Hata: {summary.errors.length}</span>
                  ) : null}
                </p>
              )
            ) : (
              <p className="text-xs text-gray-500">
                Son döngü özeti okunamadı (bozuk kayıt).
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
