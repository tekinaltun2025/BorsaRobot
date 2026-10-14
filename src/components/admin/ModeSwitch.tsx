"use client";

import { useState } from "react";
import { FlaskConical, Loader2, PlugZap, ShieldAlert, Zap } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { AdminSettingsUpdateInput, AdminSettingsView, TradingMode } from "@/lib/types";
import { SaveStatus, SettingsCard, useSaveStatus } from "./shared";

/** /api/admin/test-denizbank yanıt sözleşmesi. */
interface DenizBankTestResult {
  ok: boolean;
  mockMode: boolean;
  message: string;
  accountCount?: number;
}

/**
 * Mod anahtarı: Paper/Live trading geçişi.
 * LIVE seçildiğinde risk parametrelerini gösteren zorunlu onay diyaloğu açılır.
 */
export function ModeSwitch({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<DenizBankTestResult | null>(null);
  const mode: TradingMode = settings.tradingMode;

  /** DenizBank bağlantı testi — GetAccountList üzerinden (Faz 6). */
  async function handleTestConnection(): Promise<void> {
    setTestRunning(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/admin/test-denizbank", {
        method: "POST",
      });
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && "ok" in data) {
        setTestResult(data as DenizBankTestResult);
      } else {
        setTestResult({
          ok: false,
          mockMode: false,
          message: "Beklenmeyen yanıt biçimi.",
        });
      }
    } catch {
      setTestResult({
        ok: false,
        mockMode: false,
        message: "Sunucuya ulaşılamadı; bağlantınızı kontrol edin.",
      });
    } finally {
      setTestRunning(false);
    }
  }

  async function applyMode(next: TradingMode) {
    const update: AdminSettingsUpdateInput = { tradingMode: next };
    const result = await run(update);
    if (result) {
      onSaved({
        ...settings,
        tradingMode: next,
        liveModeConfirmedAt: next === "LIVE" ? new Date().toISOString() : settings.liveModeConfirmedAt,
      });
    }
    setConfirmOpen(false);
  }

  return (
    <SettingsCard
      title="Çalışma Modu"
      description="Sanal modda işlemler simüle edilir; canlı modda DenizBank API üzerinden gerçek döviz alım-satımı yapılır."
      icon={mode === "LIVE" ? <Zap className="h-5 w-5" aria-hidden /> : <FlaskConical className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Çalışma modu seçimi">
          {(["PAPER", "LIVE"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => (m === "LIVE" && mode !== "LIVE" ? setConfirmOpen(true) : m === "PAPER" && mode !== "PAPER" ? applyMode("PAPER") : undefined)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                mode === m
                  ? m === "LIVE"
                    ? "border-red-500 bg-red-950/40"
                    : "border-emerald-500 bg-emerald-950/30"
                  : "border-gray-700 bg-gray-950/40 hover:border-gray-600",
              )}
            >
              {m === "PAPER" ? (
                <FlaskConical className="mt-0.5 h-5 w-5 text-emerald-400" aria-hidden />
              ) : (
                <Zap className="mt-0.5 h-5 w-5 text-red-400" aria-hidden />
              )}
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {m === "PAPER" ? "Sanal (Paper Trading)" : "Canlı (Live Trading)"}
                  {mode === m ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        m === "LIVE" ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300",
                      )}
                    >
                      Aktif
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {m === "PAPER"
                    ? "Emirler sanal bakiye ile simüle edilir; gerçek para hareketi olmaz."
                    : "Emirler DenizBank ChangeExchange ile gerçek para hareketi üretir."}
                </span>
              </span>
            </button>
          ))}
        </div>

        {mode === "LIVE" ? (
          <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Canlı mod aktif. Onay damgası:{" "}
            {settings.liveModeConfirmedAt ? formatDate(settings.liveModeConfirmedAt) : "yok"}
          </p>
        ) : null}

        {/* DenizBank bağlantı testi (Faz 6) */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testRunning}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            {testRunning ? "Test ediliyor..." : "DenizBank Bağlantısını Test Et"}
          </button>
          {testResult !== null ? (
            <p
              role="status"
              className={cn(
                "rounded-lg px-3 py-2 text-xs",
                testResult.ok
                  ? "border border-emerald-800 bg-emerald-950/50 text-emerald-200"
                  : "border border-rose-800 bg-rose-950/50 text-rose-200",
              )}
            >
              {testResult.message}
              {testResult.ok && typeof testResult.accountCount === "number"
                ? ` (${testResult.accountCount} hesap)`
                : ""}
            </p>
          ) : null}
        </div>

        <SaveStatus state={state} />

        {/* LIVE onay diyaloğu */}
        {confirmOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-confirm-title"
          >
            <div className="w-full max-w-md rounded-xl border border-red-800 bg-gray-900 p-6 shadow-2xl">
              <div className="flex items-center gap-2 text-red-400">
                <ShieldAlert className="h-5 w-5" aria-hidden />
                <h3 id="live-confirm-title" className="font-semibold text-red-300">
                  Canlı Mod Onayı
                </h3>
              </div>
              <p className="mt-3 text-sm text-gray-300">
                Canlı moda geçtiğinizde otomatik alım-satım motoru{" "}
                <strong>gerçek para</strong> ile DenizBank üzerinden işlem yapacaktır.
                Aşağıdaki risk parametreleriyle çalışacağını onaylıyor musunuz?
              </p>
              <ul className="mt-3 space-y-1.5 rounded-lg bg-gray-950/60 p-3 text-xs text-gray-300">
                <li>Stop-Loss: %{settings.stopLossPercent}</li>
                <li>Take-Profit: %{settings.takeProfitPercent}</li>
                <li>Min. güven skoru: {settings.minConfidenceThreshold}</li>
                <li>Maks. pozisyon tutarı: {formatCurrency(settings.maxPositionValue)}</li>
                <li>Maks. açık pozisyon: {settings.maxOpenPositions}</li>
                <li>Günlük emir bütçesi: {formatCurrency(settings.dailyOrderBudget)}</li>
              </ul>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => applyMode("LIVE")}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                >
                  Onaylıyorum, Canlı moda Geç
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
