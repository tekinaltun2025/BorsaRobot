import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sinyal işleme yardımcıları — otomatik al/sat motorunun hesap ve kayıt
 * katmanı (iyileştirme 4.2).
 *
 * auto-trade-service.ts'ten ayrıştırıldı: döngü orkestrasyonu ile saf hesap
 * yardımcıları ayrı dosyalarda yaşar; yardımcılar bağımsız birim testine
 * açılır (tests/signal-processor.test.ts).
 */

/** Yüzde hesabı: (lastPrice - avgCost) / avgCost * 100 — Decimal (ADR-8). */
export function percentChangeFrom(
  lastPrice: Prisma.Decimal,
  avgCost: Prisma.Decimal,
): Prisma.Decimal {
  if (avgCost.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  return lastPrice.sub(avgCost).div(avgCost).mul(100);
}

/** SL/TP taraması sonucu: tetiklenen kural ve hesaplanan değişim. */
export interface SlTpEvaluation {
  /** Tetiklenen kural; eşik aşımı yoksa null (nötr bölge). */
  trigger: "STOP_LOSS" | "TAKE_PROFIT" | null;
  /** (lastPrice − avgCost) / avgCost × 100 — karar/action mesajlarında kullanılır. */
  changePercent: Prisma.Decimal;
}

/**
 * Stop-loss / take-profit eşik değerlendirmesi (saf fonksiyon):
 *  - değişim ≤ −stopLossPercent → STOP_LOSS
 *  - değişim ≥ +takeProfitPercent → TAKE_PROFIT
 *  - aksi halde null
 */
export function evaluateStopLossTakeProfit(input: {
  lastPrice: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  stopLossPercent: Prisma.Decimal;
  takeProfitPercent: Prisma.Decimal;
}): SlTpEvaluation {
  const changePercent = percentChangeFrom(input.lastPrice, input.avgCost);
  if (
    changePercent.lessThanOrEqualTo(
      input.stopLossPercent.mul(new Prisma.Decimal(-1)),
    )
  ) {
    return { trigger: "STOP_LOSS", changePercent };
  }
  if (changePercent.greaterThanOrEqualTo(input.takeProfitPercent)) {
    return { trigger: "TAKE_PROFIT", changePercent };
  }
  return { trigger: null, changePercent };
}

/**
 * ALIM emri için lot hesabı — risk kurallarıyla uyumlu hedef tutar:
 *  - maxPositionValue içinde kalan pay (limit − mevcut pozisyon maliyeti)
 *  - kullanılabilir nakdin %95'i (komisyon payı bırakılır)
 *  - günlük bütçe kalan payı yerinde placeOrder() içinde denetlenir.
 *
 * Hedef tutar fiyata bölünür, floor ile tamsayı lot iner; 0 lot çıkarsa
 * emir üretilmez (SKIPPED).
 */
export function computeBuyQuantity(input: {
  price: Prisma.Decimal;
  cashBalance: Prisma.Decimal;
  currentTotalCost: Prisma.Decimal;
  maxPositionValue: Prisma.Decimal;
}): number {
  const remainingPositionBudget = Prisma.Decimal.max(
    input.maxPositionValue.sub(input.currentTotalCost),
    new Prisma.Decimal(0),
  );
  const cashBudget = input.cashBalance.mul(new Prisma.Decimal("0.95"));
  const targetValue = Prisma.Decimal.max(
    Prisma.Decimal.min(remainingPositionBudget, cashBudget),
    new Prisma.Decimal(0),
  );
  if (targetValue.lessThanOrEqualTo(0)) return 0;
  const rawQuantity = targetValue.div(input.price).floor();
  const quantity = Number(rawQuantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

/** recordDecision girdisi — AI karar kaydı (AiDecisionLog) alanları. */
export interface RecordDecisionInput {
  jobRunId: string;
  symbol: string;
  stockId: string | null;
  action: "BUY" | "SELL" | "HOLD" | "SKIP";
  research?: string | null;
  reasoning?: string | null;
  innerMonologue?: string | null;
  confidence?: number | null;
  orderPlaced?: boolean;
  quantity?: Prisma.Decimal | null;
  price?: Prisma.Decimal | null;
  skipReason?: string | null;
  model?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
  /** Döngü özeti uyarı toplayıcısı — kayıt hatası buraya düşer. */
  warnings: string[];
}

/**
 * AI karar kaydı yazar (AiDecisionLog) — "AI Kararları" akış ekranının
 * (/ai-decisions) veri kaynağı. Döngüdeki her değerlendirme (SL/TP satışı
 * ve AI analiz sinyali) buradan kayda geçer.
 *
 * Hata izolasyonu: kayıt başarısız olursa döngü KIRILMAZ; hata warning
 * olarak döngü özetine toplanır (karar kaydı denetim/görüntüleme amaçlıdır,
 * iş mantığının parçası değildir).
 */
export async function recordDecision(
  input: RecordDecisionInput,
): Promise<void> {
  try {
    await prisma.aiDecisionLog.create({
      data: {
        jobRunId: input.jobRunId,
        symbol: input.symbol,
        action: input.action,
        research: input.research?.slice(0, 8000) ?? null,
        reasoning: input.reasoning?.slice(0, 8000) ?? null,
        innerMonologue: input.innerMonologue?.slice(0, 20_000) ?? null,
        confidence: input.confidence ?? null,
        orderPlaced: input.orderPlaced ?? false,
        quantity: input.quantity ?? null,
        price: input.price ?? null,
        skipReason: input.skipReason?.slice(0, 2000) ?? null,
        model: input.model ?? null,
        provider: input.provider ?? null,
        latencyMs: input.latencyMs ?? null,
        stockId: input.stockId ?? null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    input.warnings.push(`Karar kaydı yazılamadı (${input.symbol}): ${message}`);
  }
}
