import { Prisma, type PrismaClient } from "@prisma/client";
import type { CurrencyCode } from "@/lib/types";
import type {
  BalanceInfo,
  CurrencyRate,
  ExecuteOrderContext,
  ExecuteOrderRequest,
  ExecuteOrderResult,
  ITradingProvider,
  ProviderHealth,
  ProviderPosition,
} from "@/server/providers/trading-provider";

/**
 * Sanal ticaret sağlayıcısı — Paper Trading motoru (Bölüm 4.3).
 *
 * Davranış sözleşmesi:
 *  - Tüm işlemler tek bir Prisma transaction içinde atomik yürütülür:
 *    (fiyat okuma → bakiye kontrolü → bakiye düşümü/artırımı →
 *     pozisyon güncelleme → AccountTransaction hareket kaydı).
 *    Servis kendi transaction'ını açıp ExecuteOrderContext.tx ile geçirirse
 *    provider aynı transaction'a katılır; yoksa kendi transaction'ını açar.
 *  - Bakiye yetersizse REJECTED döner (canlıdaki 500201 semantiği).
 *  - Fiyat kaynağı: Stock.lastPrice (Faz 3'te canlı akış devralır).
 *  - executeOrder() başarılıysa status = FILLED döner; mutabakat gerektirmez.
 *  - executeOrder() idempotent'tir: orderId için zaten hareket kaydı varsa
 *    yeni işlem üretmez, mevcut sonucu yeniden kurar (invariant #2).
 *  - Order tablosunun durumunu ASLA yazmaz (invariant #1) — sonucu döner,
 *    durum güncellemesi TradingService'in sorumluluğudur.
 *  - Komisyon: alımda pozisyon maliyetine dahil (ağırlıklı ortalama maliyet
 *    yükselir), satışta hasılattan düşülür (net K/Z hesabına girer).
 */
export class PaperTradingProvider implements ITradingProvider {
  readonly mode = "PAPER" as const;

  constructor(
    /** Prisma istemcisi — servis katmanı enjekte eder (test edilebilirlik). */
    private readonly db: PrismaClient,
    /** Komisyon oranı (yüzde) — factory her çağrıda AdminSettings'ten taze okur. */
    private readonly commissionRatePercent: Prisma.Decimal,
  ) {}

  /** Kullanılacak DB istemcisi: servis transaction'ı varsa o, yoksa kendi client'ı. */
  private client(context?: ExecuteOrderContext): Prisma.TransactionClient {
    return context?.tx ?? this.db;
  }

  async executeOrder(
    request: ExecuteOrderRequest,
    context?: ExecuteOrderContext,
  ): Promise<ExecuteOrderResult> {
    const run = async (tx: Prisma.TransactionClient): Promise<ExecuteOrderResult> => {
      // --- Idempotency (invariant #2): bu emir için hareket kaydı varsa
      // yeni işlem ÜRETİLMEZ; mevcut gerçekleşmeden sonuç yeniden kurulur.
      const existingTxn = await tx.accountTransaction.findFirst({
        where: { orderId: request.orderId },
      });
      if (existingTxn) {
        return this.rebuildResultFromTransaction(request, existingTxn);
      }

      // --- Varlık türü guard'ı (iyileştirme 3.3): PAPER motoru yalnızca
      // hisse simülasyonudur; döviz emrinde kur kaynağı yoktur (getCurrencyRates
      // boş döner). Sahte kur uydurmak finansal olarak yanıltıcı olur —
      // bunun yerine dürüst, kalıcı bir ret döneriz. Eski davranış
      // ("USD" sembolü Stock'ta aranıp yanıltıcı STOCK_NOT_FOUND) bu
      // guard ile ortadan kalkar; döviz işlemi LIVE modda yapılır.
      if (request.assetType === "CURRENCY") {
        return this.rejected(
          "PAPER_FX_NOT_SUPPORTED",
          "Sanal (PAPER) modda döviz emri desteklenmez; döviz alım-satımı için canlı (LIVE) moda geçin.",
          false,
        );
      }

      // --- Fiyat kaynağı: Stock.lastPrice (Faz 2 sözleşmesi).
      const stock = await tx.stock.findUnique({
        where: { symbol: request.symbol },
      });
      if (!stock) {
        return this.rejected("STOCK_NOT_FOUND", `"${request.symbol}" sembollü hisse bulunamadı.`, false);
      }
      if (!stock.lastPrice) {
        return this.rejected(
          "PRICE_UNAVAILABLE",
          `"${request.symbol}" için güncel fiyat yok; emir gerçekleştirilemedi.`,
          true,
        );
      }
      const price = stock.lastPrice;

      // --- Sanal hesap (PAPER) — portfolio-service ile AYNI seçim kuralı:
      // en eski PAPER hesap (seed hesabı). Farklı seçim, bakiye ile özet
      // arasında tutarsızlık üretir.
      const account = await tx.account.findFirst({
        where: { accountType: "PAPER", currency: request.currency },
        orderBy: { createdAt: "asc" },
      });
      if (!account) {
        return this.rejected(
          "ACCOUNT_NOT_FOUND",
          "Sanal işlem hesabı bulunamadı. Lütfen seed'i çalıştırın.",
          false,
        );
      }

      const commission = price
        .mul(request.quantity)
        .mul(this.commissionRatePercent)
        .div(new Prisma.Decimal(100));

      if (request.side === "BUY") {
        return this.executeBuy(tx, request, account.id, account.balance, price, commission);
      }
      return this.executeSell(tx, request, account.id, account.balance, price, commission);
    };

    // Servis transaction'ı varsa ona katıl; yoksa kendi atomik transaction'ını aç.
    if (context?.tx) {
      return run(context.tx);
    }
    return this.db.$transaction(async (tx) => run(tx));
  }

  /** ALIM: bakiye düş → pozisyon oluştur/artır (ağırlıklı ort. maliyet) → hareket kaydı. */
  private async executeBuy(
    tx: Prisma.TransactionClient,
    request: ExecuteOrderRequest,
    accountId: string,
    currentBalance: Prisma.Decimal,
    price: Prisma.Decimal,
    commission: Prisma.Decimal,
  ): Promise<ExecuteOrderResult> {
    const grossValue = price.mul(request.quantity);
    const totalDebit = grossValue.add(commission);

    // Bakiye kontrolü — canlıdaki 500201 semantiği (kalıcı hata, retry yok).
    if (currentBalance.lessThan(totalDebit)) {
      return this.rejected(
        "500201",
        `Yetersiz bakiye: gereken ${totalDebit.toFixed(2)} TL, kullanılabilir ${currentBalance.toFixed(2)} TL.`,
        false,
      );
    }

    const newBalance = currentBalance.sub(totalDebit);

    // Bakiye düşümü (balance = kullanılabilir; totalBalance = bloke dahil — paper'da eşit).
    await tx.account.update({
      where: { id: accountId },
      data: { balance: newBalance, totalBalance: newBalance },
    });

    // Pozisyon: ağırlıklı ortalama maliyet (alım komisyonu maliyete dahil).
    const stock = await tx.stock.findUnique({ where: { symbol: request.symbol } });
    if (!stock) {
      return this.rejected("STOCK_NOT_FOUND", `"${request.symbol}" sembollü hisse bulunamadı.`, false);
    }

    const position = await tx.portfolio.findUnique({
      where: { stockId: stock.id },
    });

    const addedCost = grossValue.add(commission); // alım komisyonu maliyete dahil
    const newQuantity = request.quantity.add(position?.quantity ?? 0);
    const newTotalCost = addedCost.add(position?.totalCost ?? 0);
    const newAvgCost = newQuantity.greaterThan(0)
      ? newTotalCost.div(newQuantity)
      : new Prisma.Decimal(0);

    if (position) {
      await tx.portfolio.update({
        where: { id: position.id },
        data: {
          quantity: newQuantity,
          avgCost: newAvgCost,
          totalCost: newTotalCost,
        },
      });
    } else {
      await tx.portfolio.create({
        data: {
          stockId: stock.id,
          quantity: newQuantity,
          avgCost: newAvgCost,
          totalCost: newTotalCost,
        },
      });
    }

    // Hareket kaydı — bakiye değişimi izlenebilir.
    await tx.accountTransaction.create({
      data: {
        accountId,
        orderId: request.orderId,
        type: "BUY",
        currency: request.currency,
        amount: totalDebit.negated(),
        balanceAfter: newBalance,
        description: `${request.symbol} alım: ${request.quantity} adet × ${price.toFixed(2)} TL (komisyon ${commission.toFixed(2)} TL)`,
      },
    });

    return {
      status: "FILLED",
      filledQuantity: request.quantity,
      filledValue: totalDebit,
      avgPrice: price,
      commission,
      transactionId: `paper:${request.orderId}`,
      isRetryable: false,
    };
  }

  /** SATIM: pozisyon azalt/kapat → bakiye artır → net K/Z → hareket kaydı. */
  private async executeSell(
    tx: Prisma.TransactionClient,
    request: ExecuteOrderRequest,
    accountId: string,
    currentBalance: Prisma.Decimal,
    price: Prisma.Decimal,
    commission: Prisma.Decimal,
  ): Promise<ExecuteOrderResult> {
    const stock = await tx.stock.findUnique({ where: { symbol: request.symbol } });
    if (!stock) {
      return this.rejected("STOCK_NOT_FOUND", `"${request.symbol}" sembollü hisse bulunamadı.`, false);
    }

    const position = await tx.portfolio.findUnique({
      where: { stockId: stock.id },
    });
    if (!position || position.quantity.lessThan(request.quantity)) {
      const available = position?.quantity ?? new Prisma.Decimal(0);
      return this.rejected(
        "INSUFFICIENT_POSITION",
        `Yetersiz lot: satılabilir ${available.toFixed(0)} adet, istenen ${request.quantity.toFixed(0)} adet.`,
        false,
      );
    }

    const grossValue = price.mul(request.quantity);
    const netProceeds = grossValue.sub(commission); // satış komisyonu hasılattan düşer
    const costBasis = position.avgCost.mul(request.quantity); // alım komisyonu avgCost içinde
    const realizedPnl = netProceeds.sub(costBasis);

    const newBalance = currentBalance.add(netProceeds);

    // Bakiye artırımı.
    await tx.account.update({
      where: { id: accountId },
      data: { balance: newBalance, totalBalance: newBalance },
    });

    // Pozisyon azalt/kapat (quantity 0 → pozisyon kapalı kalır; kayıt korunur).
    const newQuantity = position.quantity.sub(request.quantity);
    const newTotalCost = position.totalCost.sub(costBasis);
    const newAvgCost = newQuantity.greaterThan(0)
      ? newTotalCost.div(newQuantity)
      : new Prisma.Decimal(0);

    await tx.portfolio.update({
      where: { id: position.id },
      data: {
        quantity: newQuantity,
        avgCost: newAvgCost,
        totalCost: newQuantity.greaterThan(0) ? newTotalCost : new Prisma.Decimal(0),
      },
    });

    // Hareket kaydı.
    await tx.accountTransaction.create({
      data: {
        accountId,
        orderId: request.orderId,
        type: "SELL",
        currency: request.currency,
        amount: netProceeds,
        balanceAfter: newBalance,
        description: `${request.symbol} satım: ${request.quantity} adet × ${price.toFixed(2)} TL — net K/Z ${realizedPnl.toFixed(2)} TL`,
      },
    });

    return {
      status: "FILLED",
      filledQuantity: request.quantity,
      filledValue: netProceeds,
      avgPrice: price,
      commission,
      realizedPnl,
      transactionId: `paper:${request.orderId}`,
      isRetryable: false,
    };
  }

  /** Daha önce işlenmiş bir emrin sonucunu hareket kaydından yeniden kurar. */
  private rebuildResultFromTransaction(
    request: ExecuteOrderRequest,
    txn: { type: string; amount: Prisma.Decimal; balanceAfter: Prisma.Decimal },
  ): ExecuteOrderResult {
    const isSell = txn.type === "SELL";
    const filledValue = isSell ? txn.amount : txn.amount.abs();
    return {
      status: "FILLED",
      filledQuantity: request.quantity,
      filledValue,
      transactionId: `paper:${request.orderId}`,
      isRetryable: false,
    };
  }

  /** Standart RED sonucu üretir (REJECTED — kalıcı/geçici hata sınıfıyla). */
  private rejected(
    errorCode: string,
    errorMessage: string,
    isRetryable: boolean,
  ): ExecuteOrderResult {
    return {
      status: "REJECTED",
      filledQuantity: new Prisma.Decimal(0),
      filledValue: new Prisma.Decimal(0),
      errorCode,
      errorMessage,
      isRetryable,
    };
  }

  async getPositions(): Promise<ProviderPosition[]> {
    const positions = await this.db.portfolio.findMany({
      where: { quantity: { gt: 0 } },
      include: { stock: { select: { id: true, symbol: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return positions.map((p) => ({
      stockId: p.stockId,
      symbol: p.stock.symbol,
      quantity: p.quantity,
      avgCost: p.avgCost,
      totalCost: p.totalCost,
    }));
  }

  async getBalance(currency: CurrencyCode): Promise<BalanceInfo> {
    const account = await this.db.account.findFirst({
      where: { accountType: "PAPER", currency },
    });
    if (!account) {
      throw new Error(
        `Sanal ${currency} hesabı bulunamadı. Lütfen seed'i çalıştırın: npm run db:seed`,
      );
    }
    return {
      currency,
      available: account.balance,
      total: account.totalBalance,
    };
  }

  /**
   * Paper modda belirsizlik yoktur: transactionId "paper:{orderId}" formatındadır
   * ve DB gerçeği her zaman kesindir (Bölüm 4.3 sözleşmesi).
   */
  async getOrderStatus(
    transactionId: string,
    _sessionId: string,
  ): Promise<ExecuteOrderResult> {
    const orderId = transactionId.startsWith("paper:")
      ? transactionId.slice("paper:".length)
      : transactionId;

    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return this.rejected("ORDER_NOT_FOUND", "Emir kaydı bulunamadı.", false);
    }

    const txn = await this.db.accountTransaction.findFirst({
      where: { orderId: order.id },
    });

    return {
      status: order.status as ExecuteOrderResult["status"],
      filledQuantity: order.filledPrice
        ? order.quantity
        : new Prisma.Decimal(0),
      filledValue: txn
        ? txn.type === "SELL"
          ? txn.amount
          : txn.amount.abs()
        : new Prisma.Decimal(0),
      avgPrice: order.filledPrice ?? undefined,
      transactionId,
      isRetryable: false,
    };
  }

  /**
   * Paper modda emirler anında sonuçlanır (FILLED); iptal edilebilir bir
   * PENDING emir yoktur. Yine de sözleşme gereği: FILLED emir iptali
   * reddedilir (Bölüm 3.5: FILLED → CANCELLED yasaktır).
   */
  async cancelOrder(orderId: string): Promise<ExecuteOrderResult> {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return this.rejected("ORDER_NOT_FOUND", "Emir kaydı bulunamadı.", false);
    }
    if (order.status === "FILLED") {
      return this.rejected(
        "ALREADY_FILLED",
        "Gerçekleşmiş emir iptal edilemez; ters yönde yeni emir verebilirsiniz.",
        false,
      );
    }
    return {
      status: "CANCELLED",
      filledQuantity: new Prisma.Decimal(0),
      filledValue: new Prisma.Decimal(0),
      isRetryable: false,
    };
  }

  /**
   * Döviz kurları canlı modun konusudur; paper hisse simülasyonunda kur
   * sözleşmesi boş döner (Faz 2 kısıtı: yalnızca hisse paper trading).
   */
  async getCurrencyRates(): Promise<CurrencyRate[]> {
    return [];
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      mode: this.mode,
      bankReachable: true, // paper: dış bağımlılık yok
    };
  }
}
