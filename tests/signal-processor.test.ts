import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeBuyQuantity,
  evaluateStopLossTakeProfit,
  percentChangeFrom,
  recordDecision,
} from "../src/server/services/signal-processor";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiDecisionLog: {
      create: vi.fn(),
    },
  },
}));

const dec = (value: string | number) => new Prisma.Decimal(value);

describe("percentChangeFrom", () => {
  it("pozitif değişim hesaplar", () => {
    expect(percentChangeFrom(dec(110), dec(100)).toFixed(2)).toBe("10.00");
  });

  it("negatif değişim hesaplar", () => {
    expect(percentChangeFrom(dec(90), dec(100)).toFixed(2)).toBe("-10.00");
  });

  it("sıfır/altı maliyette 0 döner (bölme koruması)", () => {
    expect(percentChangeFrom(dec(110), dec(0)).toNumber()).toBe(0);
    expect(percentChangeFrom(dec(110), dec(-5)).toNumber()).toBe(0);
  });
});

describe("evaluateStopLossTakeProfit", () => {
  const thresholds = {
    stopLossPercent: dec(5),
    takeProfitPercent: dec(10),
  };

  it("stop-loss eşiği aşıldığında STOP_LOSS tetikler", () => {
    const result = evaluateStopLossTakeProfit({
      ...thresholds,
      lastPrice: dec(94),
      avgCost: dec(100),
    });
    expect(result.trigger).toBe("STOP_LOSS");
    expect(result.changePercent.toFixed(2)).toBe("-6.00");
  });

  it("take-profit eşiği aşıldığında TAKE_PROFIT tetikler", () => {
    const result = evaluateStopLossTakeProfit({
      ...thresholds,
      lastPrice: dec(111),
      avgCost: dec(100),
    });
    expect(result.trigger).toBe("TAKE_PROFIT");
  });

  it("nötr bölgede tetiklemez", () => {
    const result = evaluateStopLossTakeProfit({
      ...thresholds,
      lastPrice: dec(105),
      avgCost: dec(100),
    });
    expect(result.trigger).toBeNull();
  });

  it("tam eşik değerleri dahil tetikler (≤ / ≥)", () => {
    expect(
      evaluateStopLossTakeProfit({
        ...thresholds,
        lastPrice: dec(95),
        avgCost: dec(100),
      }).trigger,
    ).toBe("STOP_LOSS");
    expect(
      evaluateStopLossTakeProfit({
        ...thresholds,
        lastPrice: dec(110),
        avgCost: dec(100),
      }).trigger,
    ).toBe("TAKE_PROFIT");
  });
});

describe("computeBuyQuantity", () => {
  it("nakit limitine göre lot hesaplar (%95 nakit payı)", () => {
    // 1000 nakit → 950 hedef; fiyat 10 → 95 lot.
    const quantity = computeBuyQuantity({
      price: dec(10),
      cashBalance: dec(1000),
      currentTotalCost: dec(0),
      maxPositionValue: dec(5000),
    });
    expect(quantity).toBe(95);
  });

  it("pozisyon limiti kalan paya sıkıştırır", () => {
    // maxPosition 500, mevcut maliyet 300 → kalan 200; fiyat 10 → 20 lot.
    const quantity = computeBuyQuantity({
      price: dec(10),
      cashBalance: dec(10000),
      currentTotalCost: dec(300),
      maxPositionValue: dec(500),
    });
    expect(quantity).toBe(20);
  });

  it("sıfır bütçede 0 lot döner", () => {
    const quantity = computeBuyQuantity({
      price: dec(10),
      cashBalance: dec(0),
      currentTotalCost: dec(0),
      maxPositionValue: dec(5000),
    });
    expect(quantity).toBe(0);
  });

  it("1 lota yetmeyen bütçede 0 lot döner (floor)", () => {
    // 10 nakit → %95 = 9.5 → 9.5/10 = 0.95 → floor 0.
    const quantity = computeBuyQuantity({
      price: dec(10),
      cashBalance: dec(10),
      currentTotalCost: dec(0),
      maxPositionValue: dec(5000),
    });
    expect(quantity).toBe(0);
  });
});

describe("recordDecision", () => {
  beforeEach(() => {
    vi.mocked(prisma.aiDecisionLog.create).mockReset();
  });

  it("alanları kırpıp AiDecisionLog'a yazar", async () => {
    await recordDecision({
      jobRunId: "job-1",
      symbol: "THYAO",
      stockId: "stock-1",
      action: "BUY",
      research: "r".repeat(9000),
      innerMonologue: "i".repeat(25_000),
      confidence: 0.87,
      orderPlaced: true,
      warnings: [],
    });

    expect(prisma.aiDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobRunId: "job-1",
        symbol: "THYAO",
        action: "BUY",
        research: "r".repeat(8000),
        innerMonologue: "i".repeat(20_000),
        confidence: 0.87,
        orderPlaced: true,
        stockId: "stock-1",
      }),
    });
  });

  it("kayıt hatası fırlatmaz — warning toplayıcıya düşer", async () => {
    vi.mocked(prisma.aiDecisionLog.create).mockRejectedValue(
      new Error("DB down"),
    );
    const warnings: string[] = [];

    await expect(
      recordDecision({
        jobRunId: "job-1",
        symbol: "ASELS",
        stockId: null,
        action: "HOLD",
        warnings,
      }),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Karar kaydı yazılamadı (ASELS)");
    expect(warnings[0]).toContain("DB down");
  });
});
