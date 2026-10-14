"use client";

import { useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RadioTower,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminSettingsView, PriceSourceKind } from "@/lib/types";
import { SaveStatus, SettingsCard, useSaveStatus } from "./shared";

/**
 * Fiyat kaynağı seçimi — admin paneli "Risk & Mod" sekmesi.
 *
 * Davranış sözleşmesi (AiProviderSelector deseni):
 *  - Radio: Yahoo Finance (gerçek BIST) / Simülatör (yedek) → anında
 *    PUT /api/admin/settings ile kaydedilir; onSaved ile parent güncellenir.
 *  - "Bağlantıyı Test Et": POST /api/admin/test-yahoo — THYAO.IS güncel
 *    fiyatı çekilir; sonuç testState ile gösterilir.
 */
export function PriceSourceSelector({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [source, setSource] = useState<PriceSourceKind>(settings.priceSource);
  const [testState, setTestState] = useState<{
    kind: "idle" | "testing" | "success" | "error";
    message?: string;
  }>({ kind: "idle" });

  async function handleSourceChange(next: PriceSourceKind) {
    setSource(next);
    const result = await run({ priceSource: next });
    if (result) {
      onSaved({ ...settings, priceSource: next });
    }
  }

  /** Yahoo Finance bağlantısını test eder — POST /api/admin/test-yahoo. */
  async function handleTestConnection() {
    setTestState({ kind: "testing" });
    try {
      const response = await fetch("/api/admin/test-yahoo", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "message" in payload &&
        typeof (payload as { message: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `İstek başarısız (HTTP ${response.status}).`;
      const ok =
        typeof payload === "object" &&
        payload !== null &&
        "ok" in payload &&
        (payload as { ok: unknown }).ok === true;
      setTestState({ kind: ok ? "success" : "error", message });
    } catch (error: unknown) {
      setTestState({
        kind: "error",
        message: error instanceof Error ? error.message : "Ağ hatası.",
      });
    }
  }

  return (
    <SettingsCard
      title="Fiyat Kaynağı"
      description="Piyasa verilerinin kaynağını seçin: Yahoo Finance gerçek BIST fiyatları veya yedek simülatör."
      icon={<RadioTower className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-6">
        {/* Kaynak seçimi */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-200">
            Aktif Kaynak
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["YAHOO", "SIMULATED"] as const).map((s) => (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                  source === s
                    ? "border-blue-500 bg-blue-950/40"
                    : "border-gray-700 bg-gray-950/40 hover:border-gray-600",
                )}
              >
                <input
                  type="radio"
                  name="priceSource"
                  value={s}
                  checked={source === s}
                  onChange={() => void handleSourceChange(s)}
                  className="mt-1 h-4 w-4 accent-blue-500"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    {s === "YAHOO" ? (
                      <Wifi className="h-4 w-4" aria-hidden />
                    ) : (
                      <FlaskConical className="h-4 w-4" aria-hidden />
                    )}
                    {s === "YAHOO"
                      ? "Yahoo Finance (Gerçek BIST)"
                      : "Simülatör (Yedek)"}
                  </span>
                  <span className="mt-1 block text-xs text-gray-400">
                    {s === "YAHOO"
                      ? "Gerçek BIST fiyatları Yahoo Finance'den çekilir (API key gerektirmez). Yahoo erişilemezse otomatik simülatöre düşülür."
                      : "Random walk simülatörü ile fiyat üretilir (Faz 3 motoru — yedek kaynak)."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Bağlantı testi */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testState.kind === "testing"}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testState.kind === "testing" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Activity className="h-4 w-4" aria-hidden />
            )}
            {testState.kind === "testing" ? "Test ediliyor..." : "Bağlantıyı Test Et"}
          </button>
          {testState.kind !== "idle" && testState.kind !== "testing" && (
            <div
              role="status"
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                testState.kind === "success"
                  ? "bg-emerald-950/60 text-emerald-300"
                  : "bg-red-950/60 text-red-300",
              )}
            >
              {testState.kind === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              )}
              {testState.message}
            </div>
          )}
        </div>

        <SaveStatus state={state} />
      </div>
    </SettingsCard>
  );
}
