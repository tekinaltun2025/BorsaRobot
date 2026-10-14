"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TradingMode } from "@/lib/types";
import { OrderForm, type OrderFormStock } from "@/components/trading/OrderForm";
import { OrderHistorySection } from "@/components/trading/OrderHistorySection";
import { AccountSummary } from "@/components/trading/AccountSummary";
import { PortfolioTable } from "@/components/trading/PortfolioTable";
import { PnlSection } from "@/components/trading/PnlSection";
import { RiskIndicators } from "@/components/trading/RiskIndicators";
import type { PortfolioView } from "@/server/services/portfolio-service";

/**
 * Portföy dashboard'unun etkileşimli kabuğu.
 *
 * Emir verildiğinde (onOrderPlaced) router.refresh() ile server component
 * verileri (özet + pozisyonlar) yeniden çekilir; emir geçmişi refreshKey
 * artışıyla kendi fetch'ini tetikler. Böylece tüm sayfa tek kaynaklı
 * (server) kalır, client yalnızca koordinasyon yapar.
 */
export function TradingDashboard({
  portfolio,
  stocks,
  commissionRatePercent,
  defaultSymbol,
  defaultSide,
  tradingMode,
}: {
  portfolio: PortfolioView;
  stocks: OrderFormStock[];
  commissionRatePercent: string;
  /** /stock/[symbol] hızlı emir yönlendirmesinden gelen sembol. */
  defaultSymbol?: string;
  /** /stock/[symbol] hızlı emir yönlendirmesinden gelen yön. */
  defaultSide?: "BUY" | "SELL";
  /** Aktif çalışma modu — OrderForm canlı uyarısı için (Faz 6). */
  tradingMode: TradingMode;
}) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  /** Toplu satış tamamlandığında portföy + emir geçmişi yenilenir. */
  function handleBulkSold(): void {
    setRefreshKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <AccountSummary summary={portfolio.summary} />

      {/* Risk Göstergeleri — PnL ve ayarlardan hesaplanır */}
      <RiskIndicators />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Pozisyonlar</h2>
          <PortfolioTable
            positions={portfolio.positions}
            tradingMode={tradingMode}
            onBulkSold={handleBulkSold}
          />
        </section>
        <section>
          <OrderForm
            stocks={stocks}
            cashBalance={portfolio.summary.cashBalance}
            commissionRatePercent={commissionRatePercent}
            defaultSymbol={defaultSymbol}
            defaultSide={defaultSide}
            tradingMode={tradingMode}
            onOrderPlaced={() => setRefreshKey((k) => k + 1)}
          />
        </section>
      </div>

      <PnlSection refreshKey={refreshKey} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Emir Geçmişi</h2>
        <OrderHistorySection refreshKey={refreshKey} />
      </section>
    </div>
  );
}
