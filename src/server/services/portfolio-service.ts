import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Portföy servisi — pozisyon ve hesap özeti hesaplamaları (Bölüm 3.1).
 *
 * Tüm parasal hesaplar Prisma Decimal ile yapılır (ADR-8); Number'a çevrim
 * yalnızca API görünümünde (string serileştirme) yapılır.
 *
 * K/Z modeli:
 *  - Gerçekleşmiş (realized) K/Z: SELL emirlerinin Order.realizedPnl toplamı.
 *  - Gerçekleşmemiş (unrealized) K/Z: Σ (lastPrice − avgCost) × quantity.
 *  - Toplam K/Z = gerçekleşmiş + gerçekleşmemiş.
 */

/** Tek pozisyonun API görünümü. */
export interface PositionView {
  id: string;
  stockId: string;
  symbol: string;
  name: string;
  quantity: string;
  avgCost: string;
  totalCost: string;
  lastPrice: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  unrealizedPnlPercent: string | null;
}

/** Hesap özeti kartları görünümü. */
export interface AccountSummaryView {
  accountId: string;
  currency: string;
  cashBalance: string;
  positionsValue: string;
  totalAssets: string;
  realizedPnl: string;
  unrealizedPnl: string;
  totalPnl: string;
  openPositionCount: number;
}

/** Portföy sayfasının tamamı — tek API yanıtında. */
export interface PortfolioView {
  summary: AccountSummaryView;
  positions: PositionView[];
}

const ZERO = new Prisma.Decimal(0);

/** Açık pozisyonları piyasa değeri ve K/Z ile listeler (quantity > 0). */
export async function getPositions(): Promise<PositionView[]> {
  const positions = await prisma.portfolio.findMany({
    where: { quantity: { gt: 0 } },
    include: { stock: true },
    orderBy: { updatedAt: "desc" },
  });

  return positions.map((p) => {
    const lastPrice = p.stock.lastPrice;
    const marketValue = lastPrice ? lastPrice.mul(p.quantity) : null;
    const unrealizedPnl =
      lastPrice !== null && marketValue !== null
        ? marketValue.sub(p.totalCost)
        : null;
    const unrealizedPnlPercent =
      unrealizedPnl !== null && p.totalCost.greaterThan(0)
        ? unrealizedPnl.div(p.totalCost).mul(100)
        : null;

    return {
      id: p.id,
      stockId: p.stockId,
      symbol: p.stock.symbol,
      name: p.stock.name,
      quantity: p.quantity.toString(),
      avgCost: p.avgCost.toString(),
      totalCost: p.totalCost.toString(),
      lastPrice: lastPrice ? lastPrice.toString() : null,
      marketValue: marketValue ? marketValue.toString() : null,
      unrealizedPnl: unrealizedPnl ? unrealizedPnl.toString() : null,
      unrealizedPnlPercent: unrealizedPnlPercent ? unrealizedPnlPercent.toString() : null,
    };
  });
}

/**
 * Hesap özeti: nakit bakiye + pozisyon değeri = toplam varlık; gerçekleşmiş
 * ve gerçekleşmemiş K/Z. Paper hesap yoksa hata fırlatılır (seed şartı).
 */
export async function getAccountSummary(): Promise<AccountSummaryView> {
  const account = await prisma.account.findFirst({
    where: { accountType: "PAPER" },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    throw new Error(
      "Sanal işlem hesabı bulunamadı. Lütfen seed'i çalıştırın: npm run db:seed",
    );
  }

  // K/Z sıfırlama damgası: resetAt'ten SONRA gerçekleşen satımlar hesaba
  // katılır (pnl-service ile tek kaynak — özet kartı + grafikler tutarlı).
  const pnlResetAt = await prisma.pnlReset
    .findUnique({ where: { id: "singleton" } })
    .then((r) => r?.resetAt ?? null);

  const [positions, realizedAgg] = await Promise.all([
    prisma.portfolio.findMany({
      where: { quantity: { gt: 0 } },
      include: { stock: { select: { lastPrice: true } } },
    }),
    prisma.order.aggregate({
      where: {
        side: "SELL",
        status: "FILLED",
        assetType: "STOCK",
        ...(pnlResetAt ? { createdAt: { gt: pnlResetAt } } : {}),
      },
      _sum: { realizedPnl: true },
    }),
  ]);

  let positionsValue = ZERO;
  let unrealizedPnl = ZERO;
  for (const p of positions) {
    if (p.stock.lastPrice) {
      const marketValue = p.stock.lastPrice.mul(p.quantity);
      positionsValue = positionsValue.add(marketValue);
      unrealizedPnl = unrealizedPnl.add(marketValue.sub(p.totalCost));
    }
  }

  const realizedPnl = realizedAgg._sum.realizedPnl ?? ZERO;
  const totalAssets = account.balance.add(positionsValue);
  const totalPnl = realizedPnl.add(unrealizedPnl);

  return {
    accountId: account.id,
    currency: account.currency,
    cashBalance: account.balance.toString(),
    positionsValue: positionsValue.toString(),
    totalAssets: totalAssets.toString(),
    realizedPnl: realizedPnl.toString(),
    unrealizedPnl: unrealizedPnl.toString(),
    totalPnl: totalPnl.toString(),
    openPositionCount: positions.length,
  };
}

/** Portföy sayfası görünümü: özet + pozisyonlar (tek çağrıda). */
export async function getPortfolio(): Promise<PortfolioView> {
  const [summary, positions] = await Promise.all([
    getAccountSummary(),
    getPositions(),
  ]);
  return { summary, positions };
}

/** Hesap hareketi görünümü — AccountTransaction listesi. */
export interface AccountTransactionView {
  id: string;
  type: string;
  currency: string;
  amount: string;
  balanceAfter: string;
  description: string | null;
  orderId: string | null;
  createdAt: string;
}

/** Hesap hareketlerini sayfalı listeler (yeniden eskiye). */
export async function listAccountTransactions(query: {
  page: number;
  pageSize: number;
}): Promise<{
  transactions: AccountTransactionView[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const account = await prisma.account.findFirst({
    where: { accountType: "PAPER" },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    throw new Error(
      "Sanal işlem hesabı bulunamadı. Lütfen seed'i çalıştırın: npm run db:seed",
    );
  }

  const [transactions, total] = await prisma.$transaction([
    prisma.accountTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.accountTransaction.count({ where: { accountId: account.id } }),
  ]);

  return {
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      currency: t.currency,
      amount: t.amount.toString(),
      balanceAfter: t.balanceAfter.toString(),
      description: t.description,
      orderId: t.orderId,
      createdAt: t.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
