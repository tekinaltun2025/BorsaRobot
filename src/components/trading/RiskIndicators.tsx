"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Shield, Info, XCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminSettingsView } from "@/lib/types";
import { Skeleton, SkeletonGrid, ErrorState, EmptyState } from "@/components/ui/states";

interface PnlDailyPoint {
  time: number;
  date: string;
  pnl: number;
  cumulative: number;
  count: number;
}

interface PnlOverview {
  resetAt: string | null;
  totalRealizedPnl: string;
  totalProfit: string;
  totalLoss: string;
  tradeCount: number;
  daily: PnlDailyPoint[];
  bySymbol: Array<{
    symbol: string;
    realizedPnl: string;
    tradeCount: number;
    lastTradeAt: string;
  }>;
}

export function RiskIndicators() {
  const [settings, setSettings] = useState<AdminSettingsView | null>(null);
  const [pnlData, setPnlData] = useState<PnlOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const [settingsRes, pnlRes] = await Promise.all([
          fetch("/api/admin/settings", { cache: "no-store" }),
          fetch("/api/trading/pnl", { cache: "no-store" }),
        ]);

        if (!settingsRes.ok) throw new Error("Ayarlar yüklenemedi.");
        if (!pnlRes.ok) throw new Error("K/Z verileri yüklenemedi.");

        const settingsData = await settingsRes.json();
        const pnlData = await pnlRes.json();

        setSettings(settingsData);
        setPnlData(pnlData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Veri yüklenirken hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <Skeleton className="h-6 w-32" />
        <SkeletonGrid count={4} />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Risk verileri yüklenemedi"
        message={error}
        action={<button onClick={() => window.location.reload()} className="text-sm text-blue-400 underline">Tekrar Dene</button>}
      />
    );
  }

  if (!settings || !pnlData) {
    return (
      <EmptyState title="Risk verisi yok" message="Ayarlar veya K/Z verisi bulunamadı." />
    );
  }

  // Günlük zarar hesapla (bugünkü PnL)
  const today = new Date().toISOString().slice(0, 10);
  const todayPnl = pnlData.daily.find((d) => d.date === today)?.pnl ?? 0;
  const dailyLoss = todayPnl < 0 ? Math.abs(todayPnl) : 0;

  // Limitler
  const maxDailyLossLimit = settings.maxDailyLossLimit ?? 0;
  const maxBuyAmount = settings.maxBuyAmount ?? 0;
  const maxSellAmount = settings.maxSellAmount ?? 0;
  const autoTradeApprovalMode = settings.autoTradeApprovalMode ?? "MANUAL";

  // Yüzde hesaplamaları
  const dailyLossPercent = maxDailyLossLimit > 0 ? (dailyLoss / maxDailyLossLimit) * 100 : 0;
  const isDailyLossExceeded = dailyLoss >= maxDailyLossLimit && maxDailyLossLimit > 0;
  const isDailyLossWarning = dailyLossPercent >= 80 && maxDailyLossLimit > 0;

  type IndicatorStatus = "ok" | "warning" | "danger" | "info" | "disabled";

  // Risk göstergeleri
  const indicators: {
    id: string;
    label: string;
    value: string;
    percent: number;
    status: IndicatorStatus;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  }[] = [
    {
      id: "daily-loss",
      label: "Günlük Zarar Limiti",
      value: `${formatTry(dailyLoss)} / ${formatTry(maxDailyLossLimit)}`,
      percent: dailyLossPercent,
      status: isDailyLossExceeded ? "danger" : isDailyLossWarning ? "warning" : "ok",
      icon: isDailyLossExceeded ? XCircle : isDailyLossWarning ? AlertTriangle : CheckCircle2,
      description: isDailyLossExceeded
        ? "Limit aşıldı — yeni emirler onay bekliyor"
        : isDailyLossWarning
        ? "%80 doldu — dikkatli olun"
        : "Limite uygun",
    },
    {
      id: "max-buy",
      label: "Maks. Alış Tutarı",
      value: formatTry(maxBuyAmount),
      percent: 0,
      status: maxBuyAmount > 0 ? "info" : "disabled",
      icon: Shield,
      description: maxBuyAmount > 0 ? "Tek alış emri üst sınırı" : "Limit belirlenmemiş",
    },
    {
      id: "max-sell",
      label: "Maks. Satış Tutarı",
      value: formatTry(maxSellAmount),
      percent: 0,
      status: maxSellAmount > 0 ? "info" : "disabled",
      icon: Shield,
      description: maxSellAmount > 0 ? "Tek satış emri üst sınırı" : "Limit belirlenmemiş",
    },
    {
      id: "approval-mode",
      label: "Otomatik İşlem Modu",
      value: autoTradeApprovalMode === "AUTO" ? "AUTO (Doğrudan)" : "MANUAL (Onay Bekler)",
      percent: 0,
      status: autoTradeApprovalMode === "AUTO" ? "warning" : "info",
      icon: autoTradeApprovalMode === "AUTO" ? AlertTriangle : Info,
      description:
        autoTradeApprovalMode === "AUTO"
          ? "Emirler onaysız uygulanır — dikkat!"
          : "Admin onayı gerektirir (güvenli)",
    },
  ];

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Shield className="h-5 w-5 text-blue-500" />
        Risk Durumu
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {indicators.map((indicator) => (
          <RiskIndicatorCard key={indicator.id} indicator={indicator} />
        ))}
      </div>

      {/* Uyarı bannerları */}
      {isDailyLossExceeded && (
        <div className="rounded-lg border border-red-600 bg-red-950/40 p-4 animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-300">Günlük Zarar Limiti Aşıldı</p>
              <p className="mt-1 text-sm text-gray-300">
                Bugünkü zarar <strong>{formatTry(dailyLoss)}</strong>, limit
                <strong>{formatTry(maxDailyLossLimit)}</strong> değerini aştı.
                Otomatik alım-satım motoru yeni emirler üretmeyecek; mevcut emirler
                onay beklemeye alınacak.
              </p>
            </div>
          </div>
        </div>
      )}

      {isDailyLossWarning && !isDailyLossExceeded && (
        <div className="rounded-lg border border-yellow-600 bg-yellow-950/40 p-4 animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-yellow-300">Günlük Zarar Limiti %80 Doldu</p>
              <p className="mt-1 text-sm text-gray-300">
                Bugünkü zarar <strong>{formatTry(dailyLoss)}</strong>, limitin
                <strong>%{dailyLossPercent.toFixed(0)}</strong> seviyesine ulaştı.
                Riskli pozisyonları gözden geçirin.
              </p>
            </div>
          </div>
        </div>
      )}

      {autoTradeApprovalMode === "AUTO" && (
        <div className="rounded-lg border border-blue-600 bg-blue-950/40 p-4 animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-blue-300">Otomatik İşlem Modu: AUTO</p>
              <p className="mt-1 text-sm text-gray-300">
                AI motoru ürettiği emirleri <strong>admin onayı olmadan</strong>
                doğrudan uyguluyor. Canlı modda bu ayar yüksek risk oluşturabilir.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RiskIndicatorCard({
  indicator,
}: {
  indicator: {
    id: string;
    label: string;
    value: string;
    percent: number;
    status: "ok" | "warning" | "danger" | "info" | "disabled";
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  };
}) {
  const Icon = indicator.icon;

  const statusStyles = {
    ok: "border-emerald-600 bg-emerald-950/30 text-emerald-400",
    warning: "border-yellow-600 bg-yellow-950/30 text-yellow-400",
    danger: "border-red-600 bg-red-950/30 text-red-400",
    info: "border-blue-600 bg-blue-950/30 text-blue-400",
    disabled: "border-gray-700 bg-gray-900/30 text-gray-500",
  };

  const progressStyles = {
    ok: "bg-emerald-500",
    warning: "bg-yellow-500",
    danger: "bg-red-500",
    info: "bg-blue-500",
    disabled: "bg-gray-600",
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all",
        statusStyles[indicator.status]
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium">{indicator.label}</span>
        </div>
      </div>

      <div className="mt-2 font-mono text-lg font-semibold">{indicator.value}</div>

      {indicator.percent > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className={cn("h-full transition-all duration-300", progressStyles[indicator.status])}
            style={{ width: `${Math.min(indicator.percent, 100)}%` }}
          />
        </div>
      )}

      <p className="mt-2 text-xs text-gray-400">{indicator.description}</p>
    </div>
  );
}

function formatTry(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}