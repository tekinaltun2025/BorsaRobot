import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_FX_CURRENCIES } from "@/lib/constants";
import type { CurrencyCode, OrderSide, OrderSource } from "@/lib/types";
import { resolveTradingProvider } from "@/server/providers/provider-factory";
import type { ExecuteOrderResult } from "@/server/providers/trading-provider";
import { assertRiskRules } from "@/server/services/risk-service";
import { TradingError } from "@/server/services/trading-error";

// Geriye dönük uyumluluk (iyileştirme 4.2): TradingError ayrı modüle
// taşındı (risk-service dairesel import'u önler); mevcut çağıranlar
// (API route'ları, verify scriptleri) trading-service'ten import etmeye
// devam eder.
export { TradingError } from "@/server/services/trading-error";
export type { TradingErrorCode } from "@/server/services/trading-error";

/**
 * Emir servisi — emir yaşam döngüsünün sahibi (Bölüm 3.5 durum makinesi).
 *
 * Sorumluluklar:
 *  - Emir kaydını oluşturma (PENDING) ve provider'a gerçekleştirme.
 *  - Idempotency (ADR-7): clientRequestId unique; aynı istek tekrar gelirse
 *    mevcut emir kaydı döndürülür (P2002 yakalanır, hata değil).
 *  - Risk kuralları (AdminSettings'ten): maxPositionValue, maxOpenPositions,
 *    dailyOrderBudget — ihlali anlamlı TR hata ile reddeder.
 *  - Atomicite: emir kaydı + provider gerçekleştirmesi + durum güncellemesi
 *    TEK Prisma $transaction içinde; provider ExecuteOrderContext.tx ile
 *    aynı transaction'a katılır. Bakiye/pozisyon/emir tutarlılığı asla bozulmaz.
 *  - Provider sonucuna göre Order.status güncellemesi (invariant #1: provider
 *    Order'ı yazmaz, bu servis yazar).
 *
 * Hata sözleşmesi: kullanıcıya dönük hatalar TradingError ile fırlatılır
 * (TR mesaj + HTTP'ye map edilebilir kod); beklenmedik hatalar 500'e düşer.
 */

/** Emir oluşturma girdisi — API katmanı Zod ile doğruladıktan sonra çağırır. */
export interface PlaceOrderInput {
  side: OrderSide;
  /** STOCK: BIST sembolü (örn. THYAO). CURRENCY: döviz kodu (örn. USD). */
  symbol: string;
  /** Tamsayı lot (adet) veya döviz tutarı. */
  quantity: number;
  /** Idempotency anahtarı — client üretir (UUID). */
  clientRequestId: string;
  /** Varlık türü — default STOCK (Faz 6: CURRENCY canlı döviz emirleri). */
  assetType?: "STOCK" | "CURRENCY";
  source?: OrderSource;
  analysisLogId?: string;
}

/** Emir oluşturma sonucu — API yanıtına doğrudan serileştirilebilir görünüm. */
export interface PlaceOrderResult {
  /** Aynı clientRequestId ile tekrar gelen istek için true (idempotent hit). */
  idempotentReplay: boolean;
  order: {
    id: string;
    clientRequestId: string;
    side: OrderSide;
    symbol: string;
    quantity: string;
    price: string | null;
    filledPrice: string | null;
    filledValue: string | null;
    commission: string | null;
    realizedPnl: string | null;
    status: string;
    /** Emir kaynağı: MANUAL | AUTO_ENGINE | RISK_RULE (Faz 5 UI rozeti). */
    source: OrderSource;
    errorMessage: string | null;
    createdAt: string;
  };
}

/** Emir listeleme sorgusu — sayfalama. */
export interface ListOrdersQuery {
  page: number;
  pageSize: number;
  side?: OrderSide;
  status?: string;
}

/** Decimal → string serileştirme (JSON'a güvenli; ADR-8 gösterim kuralı). */
function dec(value: Prisma.Decimal | null | undefined): string | null {
  // Açık null/undefined kontrolü (iyileştirme 4.7): Decimal(0) bir obje
  // olduğu için truthy'dir; `value ?` yanlışlıkla 0'ı da eler. Niyet
  // "değer yok" olduğundan != null ile netleştirilir.
  return value != null ? value.toString() : null;
}

/** CURRENCY emirlerinde geçerli döviz kodları — tek kaynak constants.ts (iyileştirme 4.5). */
const FX_ORDER_CURRENCIES: ReadonlySet<string> = new Set(SUPPORTED_FX_CURRENCIES);

/** Order + Stock görünümünü API yanıtına çevirir. */
function toOrderView(
  order: Prisma.OrderGetPayload<{ include: { stock: true } }>,
): PlaceOrderResult["order"] {
  return {
    id: order.id,
    clientRequestId: order.clientRequestId,
    side: order.side as OrderSide,
    symbol: order.stock?.symbol ?? order.symbol,
    quantity: order.quantity.toString(),
    price: dec(order.limitPrice),
    filledPrice: dec(order.filledPrice),
    filledValue: dec(order.filledValue),
    commission: dec(order.commission),
    realizedPnl: dec(order.realizedPnl),
    status: order.status,
    source: order.source as OrderSource,
    errorMessage: order.errorMessage,
    createdAt: order.createdAt.toISOString(),
  };
}

/**
 * Emir verir: doğrulama → risk kontrolleri → atomic gerçekleştirme.
 *
 * Akış (hepsi tek $transaction içinde):
 *  1. Idempotency: clientRequestId ile mevcut emir varsa aynen döndür.
 *  2. Hisse + fiyat doğrulaması (Stock.lastPrice).
 *  3. Risk kuralları (AdminSettings): pozisyon limiti, açık pozisyon sayısı,
 *     günlük bakiye bütçesi.
 *  4. Order kaydı (PENDING) → provider.executeOrder(tx ile) → Order güncellemesi
 *     (FILLED/REJECTED + fiyat/tutar/komisyon/K-Z alanları).
 *
 * REJECTED sonuçlar hata DEĞİLdir: emir kaydı tutarlı biçimde reddedilmiş
 * olarak döner (durum makinesi izlenebilir kalır).
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const assetType = input.assetType ?? "STOCK";

  // --- 0. Provider çözümleme (LIVE guard'ı burada fail-fast çalışır).
  const provider = await resolveTradingProvider();

  // --- 0b. CANLI MOD GÜVENLİK GUARD'I (Faz 6): LIVE provider aktifken
  // AdminSettings.liveModeConfirmedAt damgası ZORUNLUDUR. Damga, adminin
  // canlı moda geçişte gösterdiği açık onay diyalogunun kaydıdır; damga
  // yoksa (örn. DB manuel değiştirildi, onay atlandı) hiçbir emir
  // bankaya gönderilemez — fail-fast.
  if (provider.mode === "LIVE") {
    const liveSettings = await prisma.adminSettings.findUnique({
      where: { id: "singleton" },
      select: { liveModeConfirmedAt: true },
    });
    if (!liveSettings?.liveModeConfirmedAt) {
      throw new TradingError(
        "Canlı işlem onayı eksik: yönetim panelinden canlı moda geçiş " +
          "onayını tazeleyin (canlı mod damgası liveModeConfirmedAt bulunamadı).",
        "LIVE_MODE_NOT_CONFIRMED",
        403,
      );
    }
  }

  // --- 1. Idempotency (ADR-7): aynı istek varsa mevcut emri döndür.
  const existing = await prisma.order.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { stock: true },
  });
  if (existing) {
    return { idempotentReplay: true, order: toOrderView(existing) };
  }

  // --- 2. Varlık doğrulaması — türe göre dal.
  //      STOCK: sembol + güncel fiyat zorunlu. CURRENCY: döviz kodu doğrulanır
  //      (fiyat/kur provider'dan çekilir; limitPrice bilgilendirme amaçlıdır).
  let stockId: string | null = null;
  let limitPrice: Prisma.Decimal | null = null;
  let orderCurrency: CurrencyCode = "TRY";

  if (assetType === "STOCK") {
    const stock = await prisma.stock.findUnique({
      where: { symbol: input.symbol },
    });
    if (!stock) {
      throw new TradingError(
        `"${input.symbol}" sembollü hisse bulunamadı.`,
        "NOT_FOUND",
        404,
      );
    }
    if (!stock.lastPrice) {
      throw new TradingError(
        `"${input.symbol}" için güncel fiyat bulunamadı; emir verilemedi.`,
        "VALIDATION",
        422,
      );
    }
    stockId = stock.id;
    limitPrice = stock.lastPrice;
  } else {
    if (!FX_ORDER_CURRENCIES.has(input.symbol)) {
      throw new TradingError(
        `"${input.symbol}" desteklenen bir döviz kodu değil. Desteklenenler: ` +
          [...FX_ORDER_CURRENCIES].join(", ") + ".",
        "VALIDATION",
        422,
      );
    }
    orderCurrency = input.symbol as CurrencyCode;
  }

  const quantityDec = new Prisma.Decimal(input.quantity);

  // --- 3. Risk kuralları (AdminSettings'ten) — yalnızca STOCK emirleri.
  //      CURRENCY emirlerinde Portfolio tabanlı kurallar uygulanmaz; limitleri
  //      banka uygular (500201 bakiye yetersiz, 90004 limit aşımı).
  let orderStatus: string = "PENDING";
  let riskErrorMessage: string | null = null;

  if (assetType === "STOCK" && stockId !== null && limitPrice !== null) {
    const settings = await prisma.adminSettings.findUnique({
      where: { id: "singleton" },
    });
    if (settings) {
      try {
        await assertRiskRules({
          side: input.side,
          stockId,
          symbol: input.symbol,
          quantity: quantityDec,
          price: limitPrice,
          settings: {
            maxPositionValue: settings.maxPositionValue,
            maxOpenPositions: settings.maxOpenPositions,
            dailyOrderBudget: settings.dailyOrderBudget,
            maxDailyLossLimit: settings.maxDailyLossLimit,
            maxBuyAmount: settings.maxBuyAmount,
            maxSellAmount: settings.maxSellAmount,
          },
        });
      } catch (error: unknown) {
        if (error instanceof TradingError && error.code === "RISK_LIMIT") {
          orderStatus = "PENDING_APPROVAL";
          riskErrorMessage = error.message;
        } else {
          throw error;
        }
      }
    }
  }

  // --- 4. Atomic gerçekleştirme: Order kaydı + provider + durum güncellemesi.
  //      LIVE modda banka çağrıları (kur çekme + ChangeExchange + retry
  //      backoff) bu tx içinde koşar; varsayılan 5 saniyelik timeout gerçek
  //      banka gecikmelerinde aşılabilir — canlı emirler için 30 saniye.
  //      PAPER modda işlem yalnızca lokal DB'dir; varsayılan yeterlidir.
  const order = await prisma.$transaction(
    async (tx) => {
      // Transaction içinde tekrar idempotency kontrolü (yarış durumu koruması):
      // iki eşzamanlı istek aynı clientRequestId ile gelirse P2002 burada yakalanır.
      let created: Prisma.OrderGetPayload<{ include: { stock: true } }>;
      try {
        created = await tx.order.create({
          data: {
            clientRequestId: input.clientRequestId,
            side: input.side,
            assetType,
            stockId,
            symbol: input.symbol,
            quantity: quantityDec,
            currency: orderCurrency,
            limitPrice,
            status: orderStatus,
            source: input.source ?? "MANUAL",
            analysisLogId: input.analysisLogId ?? null,
            errorMessage: riskErrorMessage ?? null,
          },
          include: { stock: true },
        });
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          // Yarış durumu: paralel istek kazandı — onun emrini döndür.
          const winner = await tx.order.findUnique({
            where: { clientRequestId: input.clientRequestId },
            include: { stock: true },
          });
          if (winner) return winner;
          throw error;
        }
        throw error;
      }

      // Eğer emir onay bekliyorsa, provider'a gönderme; sadece kaydı döndür.
      if (orderStatus === "PENDING_APPROVAL") {
        return created;
      }

      // Provider'ı AYNI transaction'a dahil et (ExecuteOrderContext.tx).
      const result = await provider.executeOrder(
        {
          orderId: created.id,
          clientRequestId: input.clientRequestId,
          side: input.side,
          assetType,
          symbol: input.symbol,
          quantity: quantityDec,
          currency: orderCurrency,
          limitPrice: limitPrice ?? undefined,
          analysisLogId: input.analysisLogId,
        },
        { tx },
      );

      // Durum güncellemesi — servis katmanının sorumluluğu (invariant #1).
      const finalized = await tx.order.update({
        where: { id: created.id },
        data: orderUpdateFromResult(result),
        include: { stock: true },
      });

      return finalized;
    },
    { timeout: provider.mode === "LIVE" ? 30_000 : 5_000 },
  );

  return { idempotentReplay: false, order: toOrderView(order) };
}

/** Provider sonucundan Order güncelleme verisini kurar. */
function orderUpdateFromResult(result: ExecuteOrderResult): Prisma.OrderUpdateInput {
  if (result.status === "FILLED") {
    return {
      status: "FILLED",
      filledPrice: result.avgPrice ?? null,
      filledValue: result.filledValue,
      commission: result.commission ?? null,
      realizedPnl: result.realizedPnl ?? null,
      transactionId: result.transactionId ?? null,
      sessionId: result.sessionId ?? null,
      errorCode: null,
      errorMessage: null,
      attemptCount: { increment: 1 },
    };
  }
  if (result.status === "REJECTED") {
    return {
      status: "REJECTED",
      filledPrice: null,
      filledValue: null,
      commission: null,
      realizedPnl: null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? "Emir reddedildi.",
      attemptCount: { increment: 1 },
    };
  }
  // PENDING_RECONCILIATION / PENDING / EXECUTING — ara durumlar korunur.
  return {
    status: result.status,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    attemptCount: { increment: 1 },
  };
}

/** Toplu satış öğesi — bulkSell girdisi (API katmanı Zod ile doğrular). */
export interface BulkSellItem {
  symbol: string;
  quantity: number;
}

/**
 * Toplu satış sonucu — hata izolasyonlu özet (API yanıtına doğrudan
 * serileştirilebilir görünüm).
 */
export interface BulkSellResult {
  succeeded: {
    symbol: string;
    quantity: number;
    /** Gerçekleşmiş K/Z (Decimal string) — FILLED SELL emirlerinden. */
    realizedPnl: string | null;
    orderId: string;
  }[];
  failed: {
    symbol: string;
    quantity: number;
    /** TR hata mesajı (TradingError / REJECTED errorMessage). */
    error: string;
  }[];
  /** Başarılı öğelerin gerçekleşmiş K/Z toplamı (Decimal string). */
  totalRealizedPnl: string;
}

/**
 * Toplu satış — her öğe için placeOrder (SELL) çağırır; HATA İZOLASYONU:
 * bir semboldeki hata (yetersiz lot, pozisyon yok, fiyat yok) diğer öğeleri
 * DURDURMAZ; her öğe kendi try/catch bloğunda işlenir, sonuçlar özetlenir.
 *
 * LIVE guard (fail-fast, tek sefer): LIVE provider aktifken
 * AdminSettings.liveModeConfirmedAt damgası BİR KEZ kontrol edilir — damga
 * yoksa hiçbir emir işlenmeden 403 fırlatılır. Damga varsa her placeOrder'ın
 * kendi guard'ı da aynı damgayı okuyup geçilmiş olur. Ayrıca istemcinin onay
 * diyaloğunu geçtiği confirmLive=true bayrağı LIVE modda zorunludur — onay
 * diyaloğu atlanarak seri canlı satış yapılamaz.
 *
 * Idempotency: her öğe için clientRequestId sunucu tarafında
 * crypto.randomUUID() ile benzersiz üretilir; öğeler placeOrder üzerinden
 * geçtiği için risk kuralları, atomicite ve denetim izi otomatik uygulanır.
 */
export async function bulkSell(
  items: BulkSellItem[],
  options?: { confirmLive?: boolean },
): Promise<BulkSellResult> {
  // --- 0. Provider çözümleme + LIVE guard (fail-fast, tek sefer).
  const provider = await resolveTradingProvider();
  if (provider.mode === "LIVE") {
    const liveSettings = await prisma.adminSettings.findUnique({
      where: { id: "singleton" },
      select: { liveModeConfirmedAt: true },
    });
    if (!liveSettings?.liveModeConfirmedAt) {
      throw new TradingError(
        "Canlı işlem onayı eksik: yönetim panelinden canlı moda geçiş " +
          "onayını tazeleyin (canlı mod damgası liveModeConfirmedAt bulunamadı).",
        "LIVE_MODE_NOT_CONFIRMED",
        403,
      );
    }
    if (options?.confirmLive !== true) {
      throw new TradingError(
        "Canlı modda toplu satış için açık onay zorunludur (confirmLive=true).",
        "LIVE_MODE_NOT_CONFIRMED",
        403,
      );
    }
  }

  const succeeded: BulkSellResult["succeeded"] = [];
  const failed: BulkSellResult["failed"] = [];
  let totalRealizedPnl = new Prisma.Decimal(0);

  // --- 1. Hata izolasyonu: her öğe kendi try/catch bloğunda işlenir;
  // bir öğedeki hata döngüyü durdurmaz, failed listesine toplanır.
  for (const item of items) {
    try {
      const result = await placeOrder({
        side: "SELL",
        symbol: item.symbol,
        quantity: item.quantity,
        clientRequestId: crypto.randomUUID(),
      });
      if (result.order.status === "FILLED") {
        succeeded.push({
          symbol: item.symbol,
          quantity: item.quantity,
          realizedPnl: result.order.realizedPnl,
          orderId: result.order.id,
        });
        if (result.order.realizedPnl !== null) {
          totalRealizedPnl = totalRealizedPnl.add(
            new Prisma.Decimal(result.order.realizedPnl),
          );
        }
      } else {
        // REJECTED / PENDING_RECONCILIATION vb. — başarısız sayılır; emir
        // kaydı tutarlı biçimde kaydedilmiştir (durum makinesi izlenebilir).
        failed.push({
          symbol: item.symbol,
          quantity: item.quantity,
          error:
            result.order.errorMessage ??
            `Emir ${result.order.status} durumuna geçti.`,
        });
      }
    } catch (error: unknown) {
      failed.push({
        symbol: item.symbol,
        quantity: item.quantity,
        error:
          error instanceof TradingError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Bilinmeyen hata.",
      });
    }
  }

  return {
    succeeded,
    failed,
    totalRealizedPnl: totalRealizedPnl.toString(),
  };
}

/** Emir geçmişi — sayfalı liste (yeniden eskiye). */
export async function listOrders(
  query: ListOrdersQuery,
): Promise<{ orders: PlaceOrderResult["order"][]; total: number; page: number; pageSize: number }> {
  const where: Prisma.OrderWhereInput = {};
  if (query.side) where.side = query.side;
  if (query.status) where.status = query.status;

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: { stock: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: orders.map(toOrderView),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Tek emir getirir (detay görünümleri için). */
export async function getOrderById(orderId: string): Promise<PlaceOrderResult["order"] | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { stock: true },
  });
  return order ? toOrderView(order) : null;
}

/**
 * Onay bekleyen bir emri gerçekleştirir.
 * Risk limiti nedeniyle PENDING_APPROVAL olan emirler için kullanılır.
 */
export async function approveOrder(orderId: string): Promise<PlaceOrderResult["order"]> {
  const order = await prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!currentOrder) {
      throw new TradingError("Emir bulunamadı.", "NOT_FOUND", 404);
    }

    if (currentOrder.status !== "PENDING_APPROVAL") {
      throw new TradingError(
        `Emir onaylanamaz. Mevcut durum: ${currentOrder.status}`,
        "INVALID_STATE",
        400,
      );
    }

    const provider = await resolveTradingProvider();
    
    // Provider'ı çalıştır (tx ile)
    const result = await provider.executeOrder(
      {
        orderId: currentOrder.id,
        clientRequestId: currentOrder.clientRequestId,
        side: currentOrder.side as OrderSide,
        assetType: currentOrder.assetType as "STOCK" | "CURRENCY",
        symbol: currentOrder.symbol,
        quantity: currentOrder.quantity,
        currency: currentOrder.currency as CurrencyCode,
        limitPrice: currentOrder.limitPrice ?? undefined,
        analysisLogId: currentOrder.analysisLogId ?? undefined,
      },
      { tx },
    );

    const finalized = await tx.order.update({
      where: { id: currentOrder.id },
      data: orderUpdateFromResult(result),
      include: { stock: true },
    });

    return finalized;
  });

  return toOrderView(order);
}

/**
 * Bir emri reddeder.
 */
export async function rejectOrder(orderId: string, reason?: string): Promise<PlaceOrderResult["order"]> {
  const order = await prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!currentOrder) {
      throw new TradingError("Emir bulunamadı.", "NOT_FOUND", 404);
    }

    if (currentOrder.status !== "PENDING_APPROVAL") {
      throw new TradingError(
        `Emir reddedilemez. Mevcut durum: ${currentOrder.status}`,
        "INVALID_STATE",
        400,
      );
    }

    return await tx.order.update({
      where: { id: orderId },
      data: {
        status: "REJECTED",
        errorMessage: reason ?? "Admin tarafından reddedildi.",
        attemptCount: { increment: 1 },
      },
      include: { stock: true },
    });
  });

  return toOrderView(order);
}
