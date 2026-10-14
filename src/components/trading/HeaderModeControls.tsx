"use client";

import { useEffect, useState } from "react";
import { Bot, FlaskConical, Loader2, ShieldAlert, Zap } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { AdminSettingsView, TradingMode } from "@/lib/types";

/**
 * Header mod kontrolleri — üst menüde (Yardım linkinin yanında) iki switch:
 *
 *  1. PAPER/LIVE geçiş anahtarı: admin panelindeki ModeSwitch'in onay
 *     diyaloğu mantığını yeniden kullanır — LIVE seçilince risk parametrelerini
 *     gösteren zorunlu onay diyaloğu açılır; değişiklik PUT /api/admin/settings
 *     üzerinden uygulanır (bekleyen emir varsa 409, liveModeConfirmedAt
 *     damgası sunucu tarafında basılır — ayrı guard yazılmaz).
 *  2. Otomatik/Manuel switch: autoTradingEnabled aç/kapa — değişince aynı
 *     API'ye yalnızca autoTradingEnabled alanı gönderilir.
 *
 * Veri: sayfa yüklenirken GET /api/admin/settings (maskeli görünümde
 * tradingMode + autoTradingEnabled mevcut); değişiklik sonrası state güncellenir.
 * Mobilde etiketler gizlenir, yalnızca kompakt switch görünür.
 */
export function HeaderModeControls() {
  const [settings, setSettings] = useState<AdminSettingsView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/admin/settings");
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (!cancelled && typeof data === "object" && data !== null) {
          setSettings(data as AdminSettingsView);
        }
      } catch {
        // Header kontrolü kritik değil — sessizce yoksay (switch devre dışı görünür).
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mode: TradingMode = settings?.tradingMode ?? "PAPER";
  const autoEnabled = settings?.autoTradingEnabled ?? false;
  const loaded = settings !== null;

  /** Mod değişikliğini PUT /api/admin/settings ile uygular (admin paneliyle aynı API). */
  async function applyMode(next: TradingMode): Promise<void> {
    setConfirmOpen(false);
    setSavingMode(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradingMode: next }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `Mod değiştirilemedi (HTTP ${response.status}).`;
        setError(message);
        return;
      }
      if (typeof data === "object" && data !== null) {
        setSettings(data as AdminSettingsView);
      }
    } catch {
      setError("Sunucuya ulaşılamadı; mod değiştirilemedi.");
    } finally {
      setSavingMode(false);
    }
  }

  /** Otomatik ticaret anahtarını PUT /api/admin/settings ile değiştirir. */
  async function toggleAuto(): Promise<void> {
    if (!loaded || savingAuto) return;
    const next = !autoEnabled;
    setSavingAuto(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoTradingEnabled: next }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `Ayar güncellenemedi (HTTP ${response.status}).`;
        setError(message);
        return;
      }
      if (typeof data === "object" && data !== null) {
        setSettings(data as AdminSettingsView);
      }
    } catch {
      setError("Sunucuya ulaşılamadı; ayar güncellenemedi.");
    } finally {
      setSavingAuto(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* PAPER/LIVE geçiş anahtarı */}
      <div
        className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/80 p-1"
        role="radiogroup"
        aria-label="Çalışma modu (Sanal/Canlı)"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "PAPER"}
          disabled={!loaded || savingMode}
          onClick={() => (mode !== "PAPER" ? applyMode("PAPER") : undefined)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            mode === "PAPER"
              ? "bg-emerald-950 text-emerald-300"
              : "text-gray-400 hover:bg-gray-800",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title="Sanal mod — emirler simüle edilir"
        >
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Sanal</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "LIVE"}
          disabled={!loaded || savingMode}
          onClick={() => (mode !== "LIVE" ? setConfirmOpen(true) : undefined)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            mode === "LIVE"
              ? "bg-rose-950 text-rose-300"
              : "text-gray-400 hover:bg-gray-800",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          title="Canlı mod — DenizBank üzerinden gerçek para"
        >
          {savingMode ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Zap className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="hidden sm:inline">Canlı</span>
        </button>
      </div>

      {/* Otomatik/Manuel switch */}
      <button
        type="button"
        onClick={toggleAuto}
        disabled={!loaded || savingAuto}
        aria-pressed={autoEnabled}
        title={
          autoEnabled
            ? "Otomatik alım-satım motoru etkin — kapatmak için tıklayın"
            : "Otomatik alım-satım motoru kapalı — açmak için tıklayın"
        }
        className={cn(
          "flex items-center gap-1.5 rounded-lg border p-1 pr-2 text-xs font-semibold transition-colors",
          autoEnabled
            ? "border-purple-700 bg-purple-950/60 text-purple-300"
            : "border-gray-700 bg-gray-900/80 text-gray-400",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
            autoEnabled ? "bg-purple-500" : "bg-gray-600",
          )}
          aria-hidden
        >
          <span
            className={cn(
              "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
              autoEnabled ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </span>
        {savingAuto ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Bot className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="hidden sm:inline">{autoEnabled ? "Otomatik" : "Manuel"}</span>
      </button>

      {/* Hata mesajı — kompakt, header altına düşen toast benzeri kutu. */}
      {error !== null && (
        <div
          role="alert"
          className="absolute right-4 top-14 z-50 max-w-xs rounded-lg border border-rose-800 bg-rose-950/90 px-3 py-2 text-xs text-rose-200 shadow-lg"
        >
          <div className="flex items-start gap-1.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <div>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="mt-1 text-rose-300 underline hover:text-rose-200"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVE onay diyaloğu — admin panelindeki ModeSwitch mantığıyla aynı. */}
      {confirmOpen && settings !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="header-live-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl border border-red-800 bg-gray-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h3 id="header-live-confirm-title" className="font-semibold text-red-300">
                Canlı Mod Onayı
              </h3>
            </div>
            <p className="mt-3 text-sm text-gray-300">
              Canlı moda geçtiğinizde alım-satım motoru{" "}
              <strong>gerçek para</strong> ile DenizBank üzerinden işlem
              yapacaktır. Aşağıdaki risk parametreleriyle çalışacağını onaylıyor
              musunuz?
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
      )}
    </div>
  );
}
