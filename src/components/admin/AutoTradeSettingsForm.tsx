"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Play, RefreshCw, Save, ShieldAlert, X } from "lucide-react";
import { RISK_LIMITS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { AdminSettingsUpdateInput, AdminSettingsView } from "@/lib/types";
import type {
  AutoTradeCycleResult,
  AutoTradeRunView,
} from "@/server/services/auto-trade-service";
import { FieldLabel, SaveStatus, SettingsCard, inputClass, useSaveStatus } from "./shared";

/** JobRun durum rozetleri — son döngü listesinde kullanılır. */
const RUN_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  SUCCESS: {
    label: "Başarılı",
    className: "bg-emerald-950 text-emerald-300 border-emerald-800",
  },
  FAILED: {
    label: "Başarısız",
    className: "bg-rose-950 text-rose-300 border-rose-800",
  },
  RUNNING: {
    label: "Çalışıyor",
    className: "bg-amber-950 text-amber-300 border-amber-800",
  },
};

/** Sinyal tetikleyici etiketleri — döngü sonucu modalında. */
const TRIGGER_LABELS: Record<string, string> = {
  STOP_LOSS: "Stop-Loss",
  TAKE_PROFIT: "Take-Profit",
  AI_ANALYSIS: "AI Analiz",
};

/** Eylem sonuç renkleri — döngü sonucu modalında. */
const OUTCOME_CLASSES: Record<string, string> = {
  FILLED: "text-emerald-400",
  REJECTED: "text-rose-400",
  SKIPPED: "text-gray-400",
  ERROR: "text-rose-400",
};

/**
 * Otomatik Ticaret bölümü (Faz 5) — Risk & Mod sekmesi.
 *
 * - Motor aç/kapa anahtarı + döngü aralığı (sn) ayarı → PUT settings.
 * - "Şimdi Çalıştır": POST /api/auto-trade/run → sonuç özeti modal.
 * - Son 5 otomatik döngü kaydı (JobRun) listesi + yenile.
 */
export function AutoTradeSettingsForm({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [form, setForm] = useState({
    autoTradingEnabled: settings.autoTradingEnabled,
    autoTradeIntervalSeconds: String(settings.autoTradeIntervalSeconds),
  });

  // "Şimdi Çalıştır" durumu.
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [runNowError, setRunNowError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<AutoTradeCycleResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Son döngü kayıtları.
  const [runs, setRuns] = useState<AutoTradeRunView[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const dirty =
    form.autoTradingEnabled !== settings.autoTradingEnabled ||
    form.autoTradeIntervalSeconds !== String(settings.autoTradeIntervalSeconds);

  // Faz 6 güvenlik katmanı: LIVE modda otomatik motor bilinçli olarak devre
  // dışıdır (auto-trade-service LIVE-skip). UI bu durumu açıkça gösterir.
  const isLiveMode = settings.tradingMode === "LIVE";

  function toggleEnabled() {
    setForm((prev) => ({ ...prev, autoTradingEnabled: !prev.autoTradingEnabled }));
  }

  async function handleSave() {
    const update: AdminSettingsUpdateInput = {
      autoTradingEnabled: form.autoTradingEnabled,
      autoTradeIntervalSeconds: Number(form.autoTradeIntervalSeconds),
    };
    const result = await run(update);
    if (result) {
      onSaved({ ...settings, ...update } as AdminSettingsView);
    }
  }

  /** Son 5 otomatik döngü kaydını getirir. */
  const loadRuns = useCallback(async (): Promise<void> => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const response = await fetch("/api/auto-trade/status?runs=5", {
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || payload === null || typeof payload !== "object") {
        throw new Error(`Döngü geçmişi alınamadı (HTTP ${response.status}).`);
      }
      const recent = (payload as { recentRuns?: unknown }).recentRuns;
      setRuns(Array.isArray(recent) ? (recent as AutoTradeRunView[]) : []);
    } catch (error: unknown) {
      setRunsError(error instanceof Error ? error.message : "Bilinmeyen hata.");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  /** "Şimdi Çalıştır" — döngüyü manuel tetikler ve sonucu modalda gösterir. */
  async function handleRunNow() {
    setRunNowBusy(true);
    setRunNowError(null);
    try {
      const response = await fetch("/api/auto-trade/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload !== null &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `Döngü tetiklenemedi (HTTP ${response.status}).`;
        throw new Error(message);
      }
      setRunResult(payload as AutoTradeCycleResult);
      setModalOpen(true);
      void loadRuns();
    } catch (error: unknown) {
      setRunNowError(error instanceof Error ? error.message : "Bilinmeyen hata.");
    } finally {
      setRunNowBusy(false);
    }
  }

  // Modal açıkken Escape ile kapatma.
  useEffect(() => {
    if (!modalOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen]);

  return (
    <SettingsCard
      title="Otomatik Ticaret"
      description="Otomatik alım-satım motoru: stop-loss/take-profit taraması ve AI sinyalleriyle periyodik döngü. Yalnızca Sanal (Paper) modda çalışır."
      icon={<Bot className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-6">
        {/* --- Faz 6 güvenlik katmanı: LIVE modda motor devre dışı --- */}
        {isLiveMode && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2.5 text-xs text-amber-200"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Canlı modda otomatik alım-satım devre dışıdır.</strong>{" "}
              Motor yalnızca Sanal (Paper) modda çalışır; LIVE modda döngüler
              güvenlik gereği atlanır. Canlı emirler yalnızca Trading
              sayfasından, ekstra onay ile manuel verilebilir.
            </span>
          </p>
        )}

        {/* --- Motor anahtarı + aralık ayarı --- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-200">Motor Anahtarı</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Kapalıyken zamanlayıcı döngüleri atlar (no-op).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.autoTradingEnabled}
              aria-label="Otomatik ticaret motoru"
              onClick={toggleEnabled}
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{
                backgroundColor: form.autoTradingEnabled ? "#059669" : "#374151",
              }}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  form.autoTradingEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
                aria-hidden
              />
            </button>
          </div>

          <div>
            <FieldLabel
              htmlFor="autoTradeIntervalSeconds"
              label="Döngü Aralığı (saniye)"
              hint={`Zamanlayıcının döngüleri tetikleme sıklığı. ${RISK_LIMITS.autoTradeIntervalSeconds.min}–${RISK_LIMITS.autoTradeIntervalSeconds.max} sn`}
            />
            <input
              id="autoTradeIntervalSeconds"
              type="number"
              inputMode="numeric"
              step="10"
              min={RISK_LIMITS.autoTradeIntervalSeconds.min}
              max={RISK_LIMITS.autoTradeIntervalSeconds.max}
              value={form.autoTradeIntervalSeconds}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  autoTradeIntervalSeconds: e.target.value,
                }))
              }
              className={`${inputClass} mt-1.5 tabular-nums`}
            />
          </div>
        </div>

        {/* --- Kaydet + Şimdi Çalıştır --- */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Save className="h-4 w-4" aria-hidden />
            Otomatik Ticaret Ayarlarını Kaydet
          </button>

          <button
            type="button"
            onClick={handleRunNow}
            disabled={runNowBusy}
            className="flex items-center gap-1.5 rounded-lg border border-purple-700 bg-purple-950 px-4 py-2 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-900 disabled:opacity-40"
          >
            {runNowBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            Şimdi Çalıştır
          </button>

          <SaveStatus state={state} />
        </div>

        {runNowError !== null ? (
          <p
            role="alert"
            className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300"
          >
            {runNowError}
          </p>
        ) : null}

        {/* --- Son 5 döngü kaydı --- */}
        <div className="space-y-2 border-t border-gray-800 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-200">Son Döngüler</h3>
            <button
              type="button"
              onClick={() => void loadRuns()}
              disabled={runsLoading}
              className="flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3 w-3 ${runsLoading ? "animate-spin" : ""}`}
                aria-hidden
              />
              Yenile
            </button>
          </div>

          {runsError !== null ? (
            <p role="alert" className="text-xs text-red-400">
              {runsError}
            </p>
          ) : null}

          {runsLoading && runs.length === 0 ? (
            <p className="text-xs text-gray-500">Döngü geçmişi yükleniyor…</p>
          ) : runs.length === 0 ? (
            <p className="text-xs text-gray-500">
              Henüz otomatik döngü kaydı yok. "Şimdi Çalıştır" ile bir döngü
              tetikleyebilirsiniz.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
              {runs.map((r) => {
                const badge =
                  RUN_STATUS_BADGES[r.status] ?? {
                    label: r.status,
                    className: "bg-gray-800 text-gray-300 border-gray-700",
                  };
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                    title={r.errorMessage ?? undefined}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      <span className="tabular-nums">{formatDate(r.startedAt)}</span>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      {r.durationMs !== null ? (
                        <span className="text-gray-500">{r.durationMs} ms</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500">
                      {r.summary === null
                        ? "—"
                        : r.summary.skipped
                          ? `Atlandı: ${r.summary.skipReason ?? ""}`
                          : `Pozisyon ${r.summary.positionsChecked} · Analiz ${r.summary.analysesRun} · Emir ${r.summary.ordersPlaced} (FILLED ${r.summary.ordersFilled}) · Hata ${r.summary.errors.length}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* --- Döngü sonucu modalı --- */}
      {modalOpen && runResult !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Otomatik döngü sonucu"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold">Döngü Sonucu</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatDate(runResult.startedAt)} · {runResult.durationMs} ms ·
                  Döngü ID: {runResult.summary.cycleId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Kapat"
                className="rounded-md border border-gray-700 p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    runResult.status === "SUCCESS"
                      ? "border-emerald-800 bg-emerald-950 text-emerald-300"
                      : "border-rose-800 bg-rose-950 text-rose-300"
                  }`}
                >
                  {runResult.status === "SUCCESS" ? "Başarılı" : "Başarısız"}
                </span>
                {runResult.summary.skipped ? (
                  <span className="rounded-lg bg-amber-950/60 px-3 py-1 text-xs text-amber-300">
                    Döngü atlandı: {runResult.summary.skipReason ?? ""}
                  </span>
                ) : null}
              </div>

              {/* İstatistik ızgarası */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: "Taranan pozisyon", value: runResult.summary.positionsChecked },
                  { label: "Stop-Loss tetik", value: runResult.summary.stopLossTriggered },
                  { label: "Take-Profit tetik", value: runResult.summary.takeProfitTriggered },
                  { label: "AI analiz", value: runResult.summary.analysesRun },
                  { label: "Cooldown atlama", value: runResult.summary.analysesSkippedCooldown },
                  { label: "Key yok atlama", value: runResult.summary.analysesSkippedNoKey },
                  { label: "Emir (toplam)", value: runResult.summary.ordersPlaced },
                  { label: "Gerçekleşen", value: runResult.summary.ordersFilled },
                  { label: "Reddedilen", value: runResult.summary.ordersRejected },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2"
                  >
                    <p className="text-lg font-semibold tabular-nums text-gray-100">
                      {stat.value}
                    </p>
                    <p className="text-xs text-gray-500">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Sinyal → eylem günlüğü */}
              {runResult.summary.actions.length > 0 ? (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-gray-200">
                    Sinyal → Eylem Günlüğü
                  </h4>
                  <ul className="space-y-1.5">
                    {runResult.summary.actions.map((action, index) => (
                      <li
                        key={`${action.symbol}-${index}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-gray-100">{action.symbol}</span>
                        <span className="text-gray-500">
                          {TRIGGER_LABELS[action.trigger] ?? action.trigger}
                        </span>
                        <span
                          className={
                            action.side === "BUY"
                              ? "font-medium text-emerald-400"
                              : "font-medium text-rose-400"
                          }
                        >
                          {action.side === "BUY" ? "AL" : "SAT"}
                        </span>
                        <span
                          className={`font-medium ${OUTCOME_CLASSES[action.outcome] ?? "text-gray-300"}`}
                        >
                          {action.outcome}
                        </span>
                        <span className="w-full text-gray-400 sm:w-auto sm:flex-1">
                          {action.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Hatalar */}
              {runResult.summary.errors.length > 0 ? (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-rose-300">
                    Hatalar ({runResult.summary.errors.length})
                  </h4>
                  <ul className="space-y-1">
                    {runResult.summary.errors.map((error, index) => (
                      <li
                        key={index}
                        className="rounded-lg bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300"
                      >
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}
