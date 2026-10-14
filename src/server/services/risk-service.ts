import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appDayStart } from "@/lib/time";
import type { OrderSide } from "@/lib/types";
import { TradingError } from "@/server/services/trading-error";

/**
 * Risk servisi — emir öncesi risk kuralı denetimi (iyileştirme 4.2).
 *
 * trading-service.ts'ten ayrıştırıldı: emir servisi orkestrasyona, risk
 * denetimi bu dosyaya odaklanır. Mimari dokümandaki RiskService planının
 * (Bölüm 3.4 d/e/f maddeleri) karşılığıdır.
 */

/** Risk kuralı girdileri. */
export interface RiskRuleContext {
  side: OrderSide;
  stockId: string;
  symbol: string;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  settings: {
    maxPositionValue: Prisma.Decimal;
    maxOpenPositions: number;
    dailyOrderBudget: Prisma.Decimal;
    maxDailyLossLimit: Prisma.Decimal;
    maxBuyAmount: Prisma.Decimal;
    maxSellAmount: Prisma.Decimal;
  };
}

/**
 * Risk kuralları — ihlal halinde TradingError (RISK_LIMIT) fırlatır.
 *
 * Kurallar (Bölüm 3.4 d/e/f maddeleri):
 *  a) BUY: yeni pozisyon toplam maliyeti maxPositionValue'yi aşamaz
 *     (mevcut pozisyon maliyeti + yeni alım tutarı baz alınır).
 *  b) BUY: açık pozisyon sayısı (quantity > 0) maxOpenPositions'ı aşamaz
 *     (yeni sembol açılıyorsa sayılır).
 *  c) BUY: bugünün toplam alım tutarı (FILLED BUY emirleri) + yeni alım,
 *         dailyOrderBudget'yi aşamaz.
 *  d) SELL: pozisyon yeterliliği provider'da da kontrol edilir; burada
 *     erken kontrolle anlamlı hata mesajı verilir (DB round-trip tasarrufu).
 */
/**
 * Emir risklerini doğrular.
 * @param ctx Risk kuralı bağlamı.
 */
export async function validateOrder(ctx: RiskRuleContext): Promise<void> {
  await assertRiskRules(ctx);
}

export async function assertRiskRules(ctx: RiskRuleContext): Promise<void> {
  const { settings } = ctx;

  if (ctx.side === "BUY") {
    // (a) Maksimum tek pozisyon tutarı.
    const position = await prisma.portfolio.findUnique({
      where: { stockId: ctx.stockId },
    });
    const currentCost = position?.totalCost ?? new Prisma.Decimal(0);
    const newCost = currentCost.add(ctx.price.mul(ctx.quantity));
    if (newCost.greaterThan(settings.maxPositionValue)) {
      throw new TradingError(
        `Risk limiti: "${ctx.symbol}" pozisyon tutarı ${newCost.toFixed(2)} TL ile ` +
          `${settings.maxPositionValue.toFixed(2)} TL limitini aşıyor.`,
        "RISK_LIMIT",
        422,
      );
    }

    // (b) Maksimum açık pozisyon sayısı (yeni sembol açılıyorsa).
    if (!position || position.quantity.lessThanOrEqualTo(0)) {
      const openCount = await prisma.portfolio.count({
        where: { quantity: { gt: 0 } },
      });
      if (openCount + 1 > settings.maxOpenPositions) {
        throw new TradingError(
          `Risk limiti: en fazla ${settings.maxOpenPositions} açık pozisyon tutulabilir ` +
            `(mevcut: ${openCount}).`,
          "RISK_LIMIT",
          422,
        );
      }
    }

    // (c) Günlük alım bütçesi — gün başlangıcı Europe/Istanbul'a sabit
    // (iyileştirme 6.4): sunucu TZ'si ne olursa olsun bütçe penceresi
    // BIST gününe göre hesaplanır.
    const dayStart = appDayStart();
    const todayBuys = await prisma.order.aggregate({
      where: {
        side: "BUY",
        status: "FILLED",
        createdAt: { gte: dayStart },
      },
      _sum: { filledValue: true },
    });
    const spentToday = todayBuys._sum.filledValue ?? new Prisma.Decimal(0);
    const newSpend = spentToday.add(ctx.price.mul(ctx.quantity));
    if (newSpend.greaterThan(settings.dailyOrderBudget)) {
      throw new TradingError(
        `Risk limiti: günlük emir bütçesi aşıldı. Bugün harcanan ` +
          `${spentToday.toFixed(2)} TL + yeni emir ${ctx.price
            .mul(ctx.quantity)
            .toFixed(2)} TL > limit ${settings.dailyOrderBudget.toFixed(2)} TL.`,
        "RISK_LIMIT",
        422,
      );
    }

    // (d) Günlük maksimum zarar limiti kontrolü.
    const todayPnls = await prisma.order.findMany({
      where: {
        status: "FILLED",
        createdAt: { gte: dayStart },
        realizedPnl: { not: null },
      },
      select: { realizedPnl: true },
    });

    const totalRealizedPnl = todayPnls.reduce(
      (acc, curr) => acc.add(curr.realizedPnl!),
      new Prisma.Decimal(0),
    );

    if (totalRealizedPnl.lessThan(-settings.maxDailyLossLimit)) {
      throw new TradingError(
        `Risk limiti: günlük zarar limiti aşıldı. Bugün gerçekleşen K/Z: ` +
          `${totalRealizedPnl.toFixed(2)} TL, limit: -${settings.maxDailyLossLimit.toFixed(2)} TL.`,
        "RISK_LIMIT",
        422,
      );
    }
  } else {
    // (d) SELL: erken pozisyon yeterliliği kontrolü.
    const position = await prisma.portfolio.findUnique({
      where: { stockId: ctx.stockId },
    });
    const available = position?.quantity ?? new Prisma.Decimal(0);
    if (available.lessThan(ctx.quantity)) {
      throw new TradingError(
        `Yetersiz lot: "${ctx.symbol}" için satılabilir ${available.toFixed(0)} adet, ` +
          `istenen ${ctx.quantity.toFixed(0)} adet.`,
        "INSUFFICIENT_POSITION",
        422,
      );
    }
  }
}
