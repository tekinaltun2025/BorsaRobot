import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderSource } from "@/lib/types";
import { placeOrder, TradingError } from "@/server/services/trading-service";
import {
  analyzeStock,
  AnalysisServiceError,
} from "@/server/services/analysis-service";
import {
  computeBuyQuantity,
  evaluateStopLossTakeProfit,
  recordDecision,
} from "@/server/services/signal-processor";
import type { ILlmProvider } from "@/server/providers/llm-provider";

/**
 * Otomatik Alım-Satım Motoru — TradingEngine (Bölüm 3.4 karar akışı, Faz 5).
 *
 * runAutoTradeCycle() bir tam döngü yürütür:
 *  a) AdminSettings okunur; tradingMode PAPER değilse veya autoTradingEnabled
 *     kapalıysa döngü atlanır (no-op) ve JobRun'a SKIPPED özeti yazılır.
 *  b) Stop-loss / Take-profit taraması: tüm açık pozisyonlar gezilir;
 *     Stock.lastPrice, pozisyon ortalama maliyetiyle karşılaştırılır.
 *     Düşüş ≥ stopLossPercent → SELL (zarar kesimi); yükseliş ≥
 *     takeProfitPercent → SELL (kâr realizasyonu).
 *  c) AI analiz tetikleme: izleme listesindeki (autoAnalyze=true) her hisse
 *     için cooldown'a uyanlarda analyzeStock() çağrılır. LLM key yoksa bu
 *     adım atlanır ve loglanır — motor ASLA crash olmaz.
 *  d) Sinyal işleme: action=BUY ve confidence ≥ minConfidenceThreshold →
 *     ALIM emri; action=SELL ve pozisyon varsa → SATIM emri (tüm lot);
 *     HOLD veya eşik altı → işlem yok.
 *  e) Emirler placeOrder() üzerinden geçer — mevcut risk kuralları,
 *     idempotency (clientRequestId = auto-{cycleId}-{symbol}-{action}) ve
 *     atomicity otomatik uygulanır. Otomatik emirler source=AUTO_ENGINE
 *     olarak işaretlenir.
 *  f) Her adım JobRun kaydına yazılır (başlangıç/bitiş, durum, özet
 *     istatistik: kontrol edilen pozisyon, yapılan analiz, tetiklenen emir,
 *     hatalar).
 *
 * Hata izolasyonu: tek bir semboldeki hata tüm döngüyü DURDURMAZ — her
 * sembol kendi try/catch bloğunda işlenir, hatalar döngü özetine toplanır.
 *
 * KISIT (Faz 5): motor yalnızca PAPER modda çalışır; LIVE modda otomatik
 * döngü güvenlik gereği atlanır ve loglanır (Faz 6 kapsamı).
 */

/** Otomatik motor emir kaynağı — Order.source alanına yazılır. */
const AUTO_ORDER_SOURCE: OrderSource = "AUTO_ENGINE";

/** JobRun.jobType değeri — tüm otomatik döngü kayıtları bu türdedir. */
export const AUTO_TRADE_JOB_TYPE = "AUTO_TRADE_CYCLE";

/** Döngü içinde tek bir sembol için üretilen sinyal/eylem kaydı. */
export interface CycleActionEntry {
  symbol: string;
  /** Sinyalin kaynağı: STOP_LOSS | TAKE_PROFIT | AI_ANALYSIS. */
  trigger: "STOP_LOSS" | "TAKE_PROFIT" | "AI_ANALYSIS";
  side: "BUY" | "SELL";
  /** Emir sonucu: FILLED | REJECTED | SKIPPED | ERROR. */
  outcome: "FILLED" | "REJECTED" | "SKIPPED" | "ERROR";
  /** Emir/atlama açıklaması (UI özetinde gösterilir). */
  detail: string;
  /** Oluşan emir kimliği (varsa). */
  orderId?: string;
}

/** Döngü özet istatistikleri — JobRun.resultSummary JSON'una serileştirilir. */
export interface CycleSummary {
  /** Döngü kimliği — clientRequestId'lerin idempotency kökü. */
  cycleId: string;
  /** Döngü atlandı mı? (mod kapalı / PAPER değil). */
  skipped: boolean;
  /** Atlama nedeni (skipped=true iken). */
  skipReason: string | null;
  /** Taranan açık pozisyon sayısı. */
  positionsChecked: number;
  /** Stop-loss tetikleyen pozisyon sayısı. */
  stopLossTriggered: number;
  /** Take-profit tetikleyen pozisyon sayısı. */
  takeProfitTriggered: number;
  /** Çağrılan AI analiz sayısı. */
  analysesRun: number;
  /** Cooldown nedeniyle atlanan analiz sayısı. */
  analysesSkippedCooldown: number;
  /** LLM key yokluğu nedeniyle atlanan analiz sayısı. */
  analysesSkippedNoKey: number;
  /** Tetiklenen emir sayısı (placeOrder çağrısı). */
  ordersPlaced: number;
  /** FILLED ile sonuçlanan emir sayısı. */
  ordersFilled: number;
  /** REJECTED ile sonuçlanan emir sayısı. */
  ordersRejected: number;
  /** Sembol bazlı işlem hataları (hata izolasyonu toplayıcısı) — döngüyü FAILED yapabilir. */
  errors: string[];
  /** Sağlayıcı/altyapı uyarıları (AI erişilemedi, timeout, parse) — döngüyü FAILED yapmaz. */
  warnings: string[];
  /** AI sağlayıcı hatası nedeniyle atlanan analiz sayısı. */
  analysesSkippedProviderError: number;
  /** Sinyal → eylem günlüğü (UI özeti). */
  actions: CycleActionEntry[];
}

/** runAutoTradeCycle dönüş görünümü — API yanıtına serileştirilir. */
export interface AutoTradeCycleResult {
  /** JobRun kayıt kimliği. */
  jobRunId: string;
  /** Döngü başlangıç zamanı (ISO). */
  startedAt: string;
  /** Döngü bitiş zamanı (ISO). */
  finishedAt: string;
  /** Süre (ms). */
  durationMs: number;
  /** JobRun durumu: SUCCESS | FAILED. */
  status: "SUCCESS" | "FAILED";
  summary: CycleSummary;
}

/** Döngü çalıştırma seçenekleri. */
export interface RunCycleOptions {
  /**
   * Döngü kimliği — verilmezse UUID üretilir. Aynı cycleId ile ikinci koşu,
   * aynı clientRequestId'lere takılır (idempotency) ve yeni emir ÜRETMEZ.
   * Doğrulama scripti bu davranışı test eder.
   */
  cycleId?: string;
  /**
   * Dışarıdan enjekte edilen LLM sağlayıcısı (mock/test yolu).
   * Verilmezse analyzeStock AdminSettings'ten gerçek sağlayıcıyı kurar.
   */
  llmProvider?: ILlmProvider;
  /**
   * Analiz adımında cooldown'u yok sayar (test amaçlı).
   * Varsayılan: false — üretimde cooldown her zaman saygındır.
   */
  skipCooldown?: boolean;
}

/**
 * Döngü atlandığında JobRun'ı SUCCESS + skipped özetiyle kapatır.
 * Guard koşullarının (settings yok / LIVE mod / motor kapalı) ortak çıkışı.
 */
async function finishSkipped(
  jobRunId: string,
  startedAt: Date,
  summary: CycleSummary,
  reason: string,
): Promise<AutoTradeCycleResult> {
  summary.skipped = true;
  summary.skipReason = reason;
  const finishedAt = new Date();
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: "SUCCESS",
      finishedAt,
      processedCount: 0,
      resultSummary: JSON.stringify(summary),
    },
  });
  return {
    jobRunId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status: "SUCCESS",
    summary,
  };
}

/**
 * Bir tam otomatik döngü yürütür — motorun ana giriş noktası.
 *
 * Hata sözleşmesi: döngü kendisi beklenmedik hatada ASLA fırlatmaz; hata
 * JobRun.status=FAILED + errorMessage ile kayda geçer ve sonuç döner.
 * (Scheduler'ın interval'i bu sayede asla kırılmaz.)
 */
export async function runAutoTradeCycle(
  options: RunCycleOptions = {},
): Promise<AutoTradeCycleResult> {
  const cycleId = options.cycleId ?? crypto.randomUUID();
  const startedAt = new Date();

  // --- JobRun kaydı: RUNNING olarak açılır (denetim izi).
  const jobRun = await prisma.jobRun.create({
    data: {
      jobType: AUTO_TRADE_JOB_TYPE,
      status: "RUNNING",
      startedAt,
    },
  });

  const summary: CycleSummary = {
    cycleId,
    skipped: false,
    skipReason: null,
    positionsChecked: 0,
    stopLossTriggered: 0,
    takeProfitTriggered: 0,
    analysesRun: 0,
    analysesSkippedCooldown: 0,
    analysesSkippedNoKey: 0,
    ordersPlaced: 0,
    ordersFilled: 0,
    ordersRejected: 0,
    errors: [],
    warnings: [],
    analysesSkippedProviderError: 0,
    actions: [],
  };

  try {
    // --- (a) Guard: ayarlar + mod + anahtar. Her atlama nedeni JobRun'a
    // SUCCESS + skipped özeti olarak yazılır (denetim izi korunur).
    const settings = await prisma.adminSettings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings) {
      return await finishSkipped(jobRun.id, startedAt, summary, "AdminSettings kaydı bulunamadı.");
    }
    if (settings.tradingMode !== "PAPER") {
      // KISIT: LIVE modda otomatik döngü güvenlik gereği atlanır (Faz 6).
      return await finishSkipped(
        jobRun.id,
        startedAt,
        summary,
        `Otomatik döngü atlandı: tradingMode=${settings.tradingMode}. ` +
          "Motor yalnızca PAPER (sanal) modda çalışır; canlı modda otomatik işlem güvenlik gereği devre dışıdır.",
      );
    }
    if (!settings.autoTradingEnabled) {
      return await finishSkipped(
        jobRun.id,
        startedAt,
        summary,
        "Otomatik ticaret kapalı (autoTradingEnabled=false). Döngü no-op olarak atlandı.",
      );
    }

    // Ayarlar bu noktada TS tarafından non-null olarak daraltıldı.
    const stopLossPercent = settings.stopLossPercent;
    const takeProfitPercent = settings.takeProfitPercent;
    const minConfidence = settings.minConfidenceThreshold;
    const maxPositionValue = settings.maxPositionValue;

    // Sanal hesap bakiyesi (ALIM lot hesabı için) — portfolio-service sözleşmesi.
    const account = await prisma.account.findFirst({
      where: { accountType: "PAPER" },
      orderBy: { createdAt: "asc" },
    });
    const cashBalance = account?.balance ?? new Prisma.Decimal(0);

    // ============================================================
    // (b) Stop-loss / Take-profit taraması — açık pozisyonlar.
    // ============================================================
    const openPositions = await prisma.portfolio.findMany({
      where: { quantity: { gt: 0 } },
      include: { stock: true },
    });
    summary.positionsChecked = openPositions.length;

    /** Bu döngüde satış sinyali üretilen semboller (SL/TP). */
    const riskSellSymbols = new Set<string>();

    for (const position of openPositions) {
      const symbol = position.stock.symbol;
      try {
        const lastPrice = position.stock.lastPrice;
        if (!lastPrice) {
          summary.actions.push({
            symbol,
            trigger: "STOP_LOSS",
            side: "SELL",
            outcome: "SKIPPED",
            detail: "Güncel fiyat yok; SL/TP kontrolü yapılamadı.",
          });
          continue;
        }

        const evaluation = evaluateStopLossTakeProfit({
          lastPrice,
          avgCost: position.avgCost,
          stopLossPercent,
          takeProfitPercent,
        });
        const changePercent = evaluation.changePercent;

        if (evaluation.trigger === "STOP_LOSS") {
          // --- Stop-loss: zarar eşiği aşıldı → tüm lotu sat.
          summary.stopLossTriggered += 1;
          riskSellSymbols.add(symbol);
          const quantity = Number(position.quantity.floor());
          const result = await placeOrder({
            side: "SELL",
            symbol,
            quantity,
            clientRequestId: `auto-${cycleId}-${symbol}-SELL`,
            source: AUTO_ORDER_SOURCE,
          });
          summary.ordersPlaced += 1;
          if (result.order.status === "FILLED") {
            summary.ordersFilled += 1;
          } else if (result.order.status === "REJECTED") {
            summary.ordersRejected += 1;
          }
          await recordDecision({
            jobRunId: jobRun.id,
            symbol,
            stockId: position.stockId,
            action: "SELL",
            reasoning:
              `Stop-loss tetiklendi: pozisyon %${changePercent.toFixed(2)} değişimle ` +
              `-%${stopLossPercent.toFixed(2)} zarar eşiğini aştı — risk kuralı gereği ` +
              `${quantity} lot otomatik satıldı (${result.order.status}).`,
            research:
              `Ortalama maliyet ${position.avgCost.toString()} TL, güncel fiyat ` +
              `${lastPrice.toString()} TL — değişim %${changePercent.toFixed(2)}.`,
            orderPlaced: true,
            quantity: new Prisma.Decimal(quantity),
            price: lastPrice,
            warnings: summary.warnings,
          });
          summary.actions.push({
            symbol,
            trigger: "STOP_LOSS",
            side: "SELL",
            outcome:
              result.order.status === "FILLED"
                ? "FILLED"
                : result.order.status === "REJECTED"
                  ? "REJECTED"
                  : "SKIPPED",
            detail:
              `Stop-loss tetiklendi (değişim ${changePercent.toFixed(2)}% ≤ ` +
              `-${stopLossPercent.toFixed(2)}%): ${quantity} lot satış — ${result.order.status}`,
            orderId: result.order.id,
          });
        } else if (evaluation.trigger === "TAKE_PROFIT") {
          // --- Take-profit: kâr eşiği aşıldı → tüm lotu sat (realizasyon).
          summary.takeProfitTriggered += 1;
          riskSellSymbols.add(symbol);
          const quantity = Number(position.quantity.floor());
          const result = await placeOrder({
            side: "SELL",
            symbol,
            quantity,
            clientRequestId: `auto-${cycleId}-${symbol}-SELL`,
            source: AUTO_ORDER_SOURCE,
          });
          summary.ordersPlaced += 1;
          if (result.order.status === "FILLED") {
            summary.ordersFilled += 1;
          } else if (result.order.status === "REJECTED") {
            summary.ordersRejected += 1;
          }
          await recordDecision({
            jobRunId: jobRun.id,
            symbol,
            stockId: position.stockId,
            action: "SELL",
            reasoning:
              `Take-profit tetiklendi: pozisyon %${changePercent.toFixed(2)} değişimle ` +
              `+%${takeProfitPercent.toFixed(2)} kâr eşiğini aştı — kâr realizasyonu için ` +
              `${quantity} lot otomatik satıldı (${result.order.status}).`,
            research:
              `Ortalama maliyet ${position.avgCost.toString()} TL, güncel fiyat ` +
              `${lastPrice.toString()} TL — değişim %${changePercent.toFixed(2)}.`,
            orderPlaced: true,
            quantity: new Prisma.Decimal(quantity),
            price: lastPrice,
            warnings: summary.warnings,
          });
          summary.actions.push({
            symbol,
            trigger: "TAKE_PROFIT",
            side: "SELL",
            outcome:
              result.order.status === "FILLED"
                ? "FILLED"
                : result.order.status === "REJECTED"
                  ? "REJECTED"
                  : "SKIPPED",
            detail:
              `Take-profit tetiklendi (değişim ${changePercent.toFixed(2)}% ≥ ` +
              `${takeProfitPercent.toFixed(2)}%): ${quantity} lot satış — ${result.order.status}`,
            orderId: result.order.id,
          });
        }
      } catch (error: unknown) {
        // Hata izolasyonu: tek pozisyon hatası döngüyü durdurmaz.
        const message = error instanceof Error ? error.message : String(error);
        const brief =
          error instanceof TradingError
            ? `SL/TP ${symbol}: [${error.code}] ${message}`
            : `SL/TP ${symbol}: ${message}`;
        summary.errors.push(brief);
        summary.actions.push({
          symbol,
          trigger: "STOP_LOSS",
          side: "SELL",
          outcome: "ERROR",
          detail: brief,
        });
      }
    }

    // ============================================================
    // (c) + (d) AI analiz tetikleme ve sinyal işleme — izleme listesi.
    // ============================================================
    const watchlist = await prisma.watchlist.findMany({
      where: { autoAnalyze: true },
      include: { stock: true },
      orderBy: { createdAt: "asc" },
    });

    for (const item of watchlist) {
      const symbol = item.stock.symbol;
      try {
        // --- (c) Analiz (cooldown'a uyanlarda; hata izolasyonlu).
        const analysis = await analyzeStock(symbol, {
          skipCooldown: options.skipCooldown ?? false,
          llmProvider: options.llmProvider,
        });
        summary.analysesRun += 1;

        const confidence = new Prisma.Decimal(analysis.confidence);
        const action = analysis.action;

        // AI karar kaydının ortak alanları (AiDecisionLog) — her sinyal dalı
        // action/orderPlaced/quantity/skipReason ile tamamlar. Kayıt hatası
        // döngüyü KIRMAZ (recordDecision içinde yakalanır).
        const decisionBase = {
          jobRunId: jobRun.id,
          symbol,
          stockId: item.stockId,
          research: analysis.researchContext,
          reasoning: analysis.reasoning,
          innerMonologue: analysis.innerMonologue,
          confidence: Math.round(Number(analysis.confidence) * 100),
          model: analysis.model,
          provider: analysis.provider,
          latencyMs: analysis.latencyMs,
          warnings: summary.warnings,
        };

        // --- (d) Sinyal işleme.
        if (action === "HOLD") {
          await recordDecision({ ...decisionBase, action: "HOLD" });
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: "BUY",
            outcome: "SKIPPED",
            detail: `AI kararı HOLD (güven ${confidence.toFixed(2)}) — işlem yok.`,
          });
          continue;
        }

        if (confidence.lessThan(minConfidence)) {
          await recordDecision({
            ...decisionBase,
            action: "SKIP",
            skipReason:
              `Güven skoru ${confidence.toFixed(2)} < eşik ` +
              `${minConfidence.toFixed(2)} — emir üretilmedi.`,
          });
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: action === "BUY" ? "BUY" : "SELL",
            outcome: "SKIPPED",
            detail:
              `Güven skoru ${confidence.toFixed(2)} < eşik ` +
              `${minConfidence.toFixed(2)} — emir üretilmedi.`,
          });
          continue;
        }

        if (action === "BUY") {
          // ALIM: risk limitleriyle uyumlu lot hesabı.
          const price = item.stock.lastPrice;
          if (!price) {
            await recordDecision({
              ...decisionBase,
              action: "SKIP",
              skipReason: "Güncel fiyat yok; alım emri üretilemedi.",
            });
            summary.actions.push({
              symbol,
              trigger: "AI_ANALYSIS",
              side: "BUY",
              outcome: "SKIPPED",
              detail: "Güncel fiyat yok; alım emri üretilemedi.",
            });
            continue;
          }
          const position = await prisma.portfolio.findUnique({
            where: { stockId: item.stockId },
          });
          const quantity = computeBuyQuantity({
            price,
            cashBalance,
            currentTotalCost: position?.totalCost ?? new Prisma.Decimal(0),
            maxPositionValue,
          });
          if (quantity <= 0) {
            await recordDecision({
              ...decisionBase,
              action: "SKIP",
              skipReason:
                "Bakiye/pozisyon limiti nedeniyle 1 lot dahi alınamıyor — emir yok.",
            });
            summary.actions.push({
              symbol,
              trigger: "AI_ANALYSIS",
              side: "BUY",
              outcome: "SKIPPED",
              detail:
                "Bakiye/pozisyon limiti nedeniyle 1 lot dahi alınamıyor — emir yok.",
            });
            continue;
          }
          const result = await placeOrder({
            side: "BUY",
            symbol,
            quantity,
            clientRequestId: `auto-${cycleId}-${symbol}-BUY`,
            source: AUTO_ORDER_SOURCE,
            analysisLogId: analysis.id,
          });
          summary.ordersPlaced += 1;
          if (result.order.status === "FILLED") {
            summary.ordersFilled += 1;
          } else if (result.order.status === "REJECTED") {
            summary.ordersRejected += 1;
          }
          await recordDecision({
            ...decisionBase,
            action: "BUY",
            orderPlaced: true,
            quantity: new Prisma.Decimal(quantity),
            price,
          });
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: "BUY",
            outcome:
              result.order.status === "FILLED"
                ? "FILLED"
                : result.order.status === "REJECTED"
                  ? "REJECTED"
                  : "SKIPPED",
            detail:
              `AI BUY sinyali (güven ${confidence.toFixed(2)}): ${quantity} lot alım — ` +
              result.order.status,
            orderId: result.order.id,
          });
        } else {
          // SATIM: yalnızca pozisyon varsa (tüm lot).
          const position = await prisma.portfolio.findUnique({
            where: { stockId: item.stockId },
          });
          const available = position?.quantity ?? new Prisma.Decimal(0);
          if (available.lessThanOrEqualTo(0)) {
            await recordDecision({
              ...decisionBase,
              action: "SKIP",
              skipReason: "AI SELL sinyali ancak açık pozisyon yok — işlem yok.",
            });
            summary.actions.push({
              symbol,
              trigger: "AI_ANALYSIS",
              side: "SELL",
              outcome: "SKIPPED",
              detail: "AI SELL sinyali ancak açık pozisyon yok — işlem yok.",
            });
            continue;
          }
          const quantity = Number(available.floor());
          const result = await placeOrder({
            side: "SELL",
            symbol,
            quantity,
            clientRequestId: `auto-${cycleId}-${symbol}-SELL`,
            source: AUTO_ORDER_SOURCE,
            analysisLogId: analysis.id,
          });
          summary.ordersPlaced += 1;
          if (result.order.status === "FILLED") {
            summary.ordersFilled += 1;
          } else if (result.order.status === "REJECTED") {
            summary.ordersRejected += 1;
          }
          await recordDecision({
            ...decisionBase,
            action: "SELL",
            orderPlaced: true,
            quantity: new Prisma.Decimal(quantity),
            price: item.stock.lastPrice,
          });
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: "SELL",
            outcome:
              result.order.status === "FILLED"
                ? "FILLED"
                : result.order.status === "REJECTED"
                  ? "REJECTED"
                  : "SKIPPED",
            detail:
              `AI SELL sinyali (güven ${confidence.toFixed(2)}): ${quantity} lot satış — ` +
              result.order.status,
            orderId: result.order.id,
          });
        }
      } catch (error: unknown) {
        // Hata izolasyonu: analiz/emir hatası döngüyü durdurmaz.
        if (
          error instanceof AnalysisServiceError &&
          error.code === "COOLDOWN"
        ) {
          // Cooldown normal akıştır — hata değil, atlama sayacı.
          summary.analysesSkippedCooldown += 1;
          continue;
        }
        if (
          error instanceof AnalysisServiceError &&
          error.code === "MISSING_API_KEY"
        ) {
          // LLM key yok: analiz adımı atlanır, motor crash olmaz.
          summary.analysesSkippedNoKey += 1;
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: "BUY",
            outcome: "SKIPPED",
            detail: "LLM API key tanımlı değil — analiz adımı atlandı.",
          });
          continue;
        }
        if (
          error instanceof AnalysisServiceError &&
          (error.code === "PROVIDER_ERROR" ||
            error.code === "TIMEOUT" ||
            error.code === "PARSE_ERROR")
        ) {
          // Sağlayıcı/altyapı sorunu (ağ hatası, timeout, parse): geçici
          // durum — uyarı olarak işaretlenir, döngü FAILED YAPILMAZ. Motor
          // sonraki tick'te tekrar dener; terminal spam'i scheduler'da
          // durum-farkındalıklı log ile bastırılır.
          summary.analysesSkippedProviderError += 1;
          const brief = `AI ${symbol}: ${error.message}`;
          summary.warnings.push(brief);
          summary.actions.push({
            symbol,
            trigger: "AI_ANALYSIS",
            side: "BUY",
            outcome: "SKIPPED",
            detail: brief,
          });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const brief =
          error instanceof TradingError
            ? `AI ${symbol}: [${error.code}] ${message}`
            : `AI ${symbol}: ${message}`;
        summary.errors.push(brief);
        summary.actions.push({
          symbol,
          trigger: "AI_ANALYSIS",
          side: "BUY",
          outcome: "ERROR",
          detail: brief,
        });
      }
    }

    // --- (f) JobRun kapanışı: SUCCESS (sembol hataları döngüyü bozmaz).
    // FAILED yalnızca İŞLEM hatası varken (SL/TP emir hatası vb.) ve hiç
    // iş/analiz yapılamamışken verilir. AI sağlayıcı uyarıları (warnings —
    // ağ hatası, timeout, parse) döngüyü FAILED yapmaz: geçici altyapı
    // sorunudur, sonraki tick'te tekrar denemesi beklenir.
    const finishedAt = new Date();
    const status: "SUCCESS" | "FAILED" =
      summary.errors.length > 0 && summary.ordersPlaced === 0 && summary.analysesRun === 0
        ? "FAILED"
        : "SUCCESS";

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status,
        finishedAt,
        processedCount: summary.positionsChecked + summary.analysesRun,
        errorMessage:
          summary.errors.length > 0
            ? summary.errors.slice(0, 10).join(" | ").slice(0, 4000)
            : null,
        resultSummary: JSON.stringify(summary),
      },
    });

    return {
      jobRunId: jobRun.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status,
      summary,
    };
  } catch (error: unknown) {
    // Beklenmedik üst düzey hata: JobRun FAILED olarak kapatılır, fırlatılmaz.
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(`Döngü üst düzey hata: ${message}`);
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "FAILED",
        finishedAt,
        errorMessage: message.slice(0, 4000),
        resultSummary: JSON.stringify(summary),
      },
    });
    return {
      jobRunId: jobRun.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "FAILED",
      summary,
    };
  }
}

/** Son otomatik döngü kayıtlarının UI görünümü. */
export interface AutoTradeRunView {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** resultSummary'den çözülen döngü özeti (bozuk JSON'ta null). */
  summary: CycleSummary | null;
  errorMessage: string | null;
}

/** JobRun kaydını UI görünümüne çevirir (resultSummary parse'lı). */
function toRunView(run: {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  resultSummary: string | null;
}): AutoTradeRunView {
  let summary: CycleSummary | null = null;
  if (run.resultSummary) {
    try {
      summary = JSON.parse(run.resultSummary) as CycleSummary;
    } catch {
      summary = null;
    }
  }
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs:
      run.finishedAt !== null
        ? run.finishedAt.getTime() - run.startedAt.getTime()
        : null,
    summary,
    errorMessage: run.errorMessage,
  };
}

/** Son N otomatik döngü kaydını listeler (admin paneli + trading kartı). */
export async function listRecentAutoTradeRuns(
  limit: number = 5,
): Promise<AutoTradeRunView[]> {
  const runs = await prisma.jobRun.findMany({
    where: { jobType: AUTO_TRADE_JOB_TYPE },
    orderBy: { startedAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
  });
  return runs.map(toRunView);
}

/** Motor durum kartı görünümü — /trading ve admin paneli. */
export interface AutoTradeStatusView {
  /** AdminSettings'ten: motor anahtarı. */
  enabled: boolean;
  /** AdminSettings'ten: döngü aralığı (saniye). */
  intervalSeconds: number;
  /** Scheduler bu process'te çalışıyor mu (instrumentation durumu). */
  schedulerRunning: boolean;
  /** Son döngü kaydı (hiç koşmadıysa null). */
  lastRun: AutoTradeRunView | null;
}

/** Motor durumunu getirir (settings + scheduler + son JobRun). */
export async function getAutoTradeStatus(): Promise<AutoTradeStatusView> {
  const [settings, lastRunRow, schedulerState] = await Promise.all([
    prisma.adminSettings.findUnique({
      where: { id: "singleton" },
      select: { autoTradingEnabled: true, autoTradeIntervalSeconds: true },
    }),
    prisma.jobRun.findFirst({
      where: { jobType: AUTO_TRADE_JOB_TYPE },
      orderBy: { startedAt: "desc" },
    }),
    import("@/server/services/scheduler").then(
      (mod) => mod.isSchedulerRunning(),
    ),
  ]);

  return {
    enabled: settings?.autoTradingEnabled ?? false,
    intervalSeconds: settings?.autoTradeIntervalSeconds ?? 60,
    schedulerRunning: schedulerState,
    lastRun: lastRunRow ? toRunView(lastRunRow) : null,
  };
}
