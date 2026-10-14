import Link from "next/link";
import {
  ArrowRight,
  Bot,
  FlaskConical,
  LineChart,
  Newspaper,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn, formatCurrency } from "@/lib/utils";
import type { TradingMode, WatchlistPriceView } from "@/lib/types";
import { getAccountSummary } from "@/server/services/portfolio-service";
import { getWatchlistPrices } from "@/server/services/price-service";

/**
 * İyileştirme 5.4: force-dynamic yerine 10 saniyelik ISR — ana sayfa her
 * ziyarette tam DB taraması yapmak yerine 10 sn boyunca cache'ten sunulur.
 * Fiyat verisi tick aralığıyla (≥30 sn) zaten gecikmeli olduğundan 10 sn
 * tazelik kaybı kabul edilebilir; DB yükü ziyaret başına sabitlenir.
 */
export const revalidate = 10;

interface DashboardStats {
  stockCount: number;
  watchlistCount: number;
  paperBalance: number;
  totalAssets: number;
  totalPnl: number;
  openPositionCount: number;
  tradingMode: TradingMode;
}

async function getDashboardStats(): Promise<DashboardStats> {
  const [stockCount, watchlistCount, settings, summary] =
    await Promise.all([
      prisma.stock.count(),
      prisma.watchlist.count(),
      prisma.adminSettings.findFirst({ select: { tradingMode: true } }),
      // Faz 2: gerçek portföy verisi — bakiye + pozisyon değeri + K/Z.
      getAccountSummary(),
    ]);

  return {
    stockCount,
    watchlistCount,
    paperBalance: Number(summary.cashBalance),
    totalAssets: Number(summary.totalAssets),
    totalPnl: Number(summary.totalPnl),
    openPositionCount: summary.openPositionCount,
    tradingMode: (settings?.tradingMode as TradingMode | null) ?? "PAPER",
  };
}

export default async function HomePage() {
  const [stats, watchlistPrices] = await Promise.all([
    getDashboardStats(),
    getWatchlistPrices(),
  ]);

  // Günlük değişime göre sırala: yükselenler ve düşenler (en fazla 5'er).
  const withChange = watchlistPrices
    .filter((p): p is WatchlistPriceView & { changePercent: string } => p.changePercent !== null)
    .map((p) => ({ ...p, pct: Number(p.changePercent) }));
  const gainers = [...withChange].sort((a, b) => b.pct - a.pct).slice(0, 5);
  const losers = [...withChange].sort((a, b) => a.pct - b.pct).slice(0, 5);

  const cards = [
    {
      label: "Takip Edilen Hisseler",
      value: String(stats.stockCount),
      icon: TrendingUp,
      hint: "Veri tabanında kayıtlı BIST hisseleri",
      tone: "neutral" as const,
    },
    {
      label: "İzleme Listesi",
      value: String(stats.watchlistCount),
      icon: LineChart,
      hint: "Aktif izleme listesi sembolleri",
      tone: "neutral" as const,
    },
    {
      label: "Toplam Varlık",
      value: formatCurrency(stats.totalAssets),
      icon: FlaskConical,
      hint: `Nakit ${formatCurrency(stats.paperBalance)} · ${stats.openPositionCount} pozisyon`,
      tone: "neutral" as const,
    },
    {
      label: "Toplam K/Z",
      value: formatCurrency(stats.totalPnl),
      icon: Scale,
      hint: "Gerçekleşen + açık pozisyon kâr/zararı",
      tone: (stats.totalPnl > 0
        ? "positive"
        : stats.totalPnl < 0
          ? "negative"
          : "neutral") as "positive" | "negative" | "neutral",
    },
  ] as const;

  const roadmap = [
    {
      icon: Newspaper,
      title: "Haber Analizi",
      description:
        "Günlük haber akışı LLM ile taranır, hisse sembolleriyle eşleştirilir ve duygu analizi üretilir.",
    },
    {
      icon: Bot,
      title: "Otomatik Alım-Satım",
      description:
        "AI analizi + risk kuralları birleşerek emir üretir; Paper modda simüle, Live modda DenizBank üzerinden gerçekleşir.",
    },
    {
      icon: LineChart,
      title: "Grafikler & Portföy",
      description:
        "TradingView Lightweight Charts ile fiyat grafikleri, pozisyon ve kâr/zarar takibi.",
    },
  ] as const;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Panel</h1>
        <p className="max-w-2xl text-sm text-gray-400">
          AI destekli borsa takip, haber analizi ve otomatik alım-satım platformuna
          hoş geldiniz. Paper trading motoru aktif: sanal bakiyenizle alım-satım
          yapabilir, pozisyon ve kâr/zarar takibini Trading sayfasından
          yürütebilirsiniz.
        </p>
      </section>

      <section
        aria-label="Özet göstergeler"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {card.label}
              </span>
              <card.icon className="h-4 w-4 text-blue-500" aria-hidden />
            </div>
            <p
              className={
                card.tone === "positive"
                  ? "mt-3 text-2xl font-semibold tabular-nums text-emerald-400"
                  : card.tone === "negative"
                    ? "mt-3 text-2xl font-semibold tabular-nums text-rose-400"
                    : "mt-3 text-2xl font-semibold tabular-nums"
              }
            >
              {card.value}
            </p>
            <p className="mt-1 text-xs text-gray-500">{card.hint}</p>
          </div>
        ))}
      </section>

      {/* Faz 3: izleme listesi özeti — en çok yükselen/düşen 5 hisse. */}
      <section aria-label="İzleme listesi özeti" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">İzleme Listesi Özeti</h2>
          <Link
            href="/watchlist"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            Tümünü Gör
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              { title: "En Çok Yükselenler", items: gainers, icon: TrendingUp },
              { title: "En Çok Düşenler", items: losers, icon: TrendingDown },
            ] as const
          ).map((panel) => (
            <div
              key={panel.title}
              className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
            >
              <div className="flex items-center gap-2">
                <panel.icon className="h-4 w-4 text-blue-500" aria-hidden />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  {panel.title}
                </h3>
              </div>
              {panel.items.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  Henüz günlük değişim verisi yok. İzleme listesi sayfasından
                  {'"Şimdi Yenile"'} ile tick tetikleyin.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-800/60">
                  {panel.items.map((item) => (
                    <li key={item.stockId}>
                      <Link
                        href={`/stock/${item.symbol}`}
                        className="flex items-center justify-between py-2.5 transition-colors hover:opacity-80"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="font-semibold text-blue-400">
                            {item.symbol}
                          </span>
                          <span className="max-w-36 truncate text-xs text-gray-500">
                            {item.name}
                          </span>
                        </span>
                        <span className="flex items-center gap-3 tabular-nums">
                          <span className="text-sm text-gray-300">
                            {item.lastPrice
                              ? formatCurrency(Number(item.lastPrice))
                              : "—"}
                          </span>
                          <span
                            className={cn(
                              "text-sm font-medium",
                              item.pct > 0 && "text-emerald-400",
                              item.pct < 0 && "text-rose-400",
                              item.pct === 0 && "text-gray-400",
                            )}
                          >
                            {item.pct > 0 ? "+" : ""}
                            {item.pct.toFixed(2)}%
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Yaklaşan yetenekler" className="space-y-4">
        <h2 className="text-lg font-semibold">Platform Yetenekleri</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {roadmap.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
            >
              <item.icon className="h-6 w-6 text-blue-500" aria-hidden />
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-400">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-xl border border-blue-900/50 bg-blue-950/30 p-6 md:grid-cols-2">
        <div>
          <h2 className="font-semibold text-blue-100">Trading Motoru Aktif</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-blue-200/80">
            Sanal bakiyenizle alım-satım emirleri verebilirsiniz. Emirler
            komisyonla birlikte atomik biçimde işlenir; pozisyonlar ağırlıklı
            ortalama maliyet yöntemiyle izlenir.
          </p>
          <Link
            href="/trading"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Trading Sayfasına Git
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div>
          <h2 className="font-semibold text-blue-100">Yönetim Paneli</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-blue-200/80">
            AI sağlayıcısını, modeli, analiz promptlarını, risk parametrelerini ve
            Paper/Canlı mod anahtarını yönetim panelinden yapılandırabilirsiniz.
          </p>
          <Link
            href="/admin"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-blue-500 px-4 py-2 text-sm font-medium text-blue-200 transition-colors hover:bg-blue-900/40"
          >
            Yönetim Paneline Git
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
