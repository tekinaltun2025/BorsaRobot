import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_FX_CURRENCIES, type SupportedFxCurrency } from "@/lib/constants";
import type { CurrencyCode, TradingMode } from "@/lib/types";
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
import {
  DenizBankClientError,
  type DenizBankBaseClient,
} from "@/server/providers/denizbank/denizbank-base-client";
import type { ChangeExchangeParams } from "@/server/providers/denizbank/denizbank-contract";

/**
 * Canlı ticaret sağlayıcısı — DenizBank API Market adaptörü (Bölüm 4.4).
 *
 * Davranış sözleşmesi:
 *  - executeOrder() yalnızca CURRENCY emirlerini gerçekleştirir: DenizBank
 *    API Market'te hisse senedi emir endpoint'i YOKTUR (doküman taraması:
 *    yalnızca ChangeExchange döviz alım-satımı mevcuttur). STOCK emirleri
 *    anlamlı TR hata ile REJECTED döner — sessizce simüle EDİLMEZ.
 *  - Guard zinciri: ChangeExchange öncesi GetCurrencyRateList ile güncel
 *    kur çekilir; kur yoksa emir bankaya HİÇ GÖNDERİLMEZ (REJECTED).
 *  - ChangeExchange çağrısında Amount/ConvertedAmount asimetrisi
 *    buildChangeExchangeParams() içinde TEK yerde kapsüllenir:
 *      SATIŞ: Amount = döviz tutarı, ConvertedAmount = TL karşılığı.
 *      ALIM:  Amount = TL tutarı,      ConvertedAmount = alınacak döviz.
 *  - Banka yanıtı alınırsa TransactionID + SessionID Order'a yazılır
 *    (mutabakat referansı); timeout/kopmada PENDING_RECONCILIATION döner —
 *    emir asla FAILED yapılmaz (Bölüm 2.4 kritik kural).
 *  - 90012/90020 (DEFERRED): emir PENDING kalır; koşul ortadan kalkınca
 *    denetim döngüsü yeniden dener.
 *  - PERMANENT banka hataları (500201 bakiye, 90004 limit, ...): REJECTED.
 *
 * INVARIANT'LAR (ITradingProvider):
 *  1. Order tablosunun durumunu doğrudan YAZMAZ — sonucu döner.
 *  2. Idempotent: aynı orderId için banka hareketi tekrarlanmaz; DB'deki
 *     AccountTransaction kaydı referans alınır.
 *  3. Timeout → PENDING_RECONCILIATION; asla FAILED değil.
 *  4. Tüm parasal alanlar Prisma.Decimal (ADR-8).
 *
 * Hesap tutarlılığı: LIVE modda yalnızca accountType="LIVE" hesaplar
 * kullanılır (PAPER hesaplara asla dokunulmaz) — Account.mode ayrımı.
 */

/**
 * DenizBank ChangeExchange TransactionType union'ı ile birebir eşleşen
 * döviz cinsi — tip güvenliği tek kaynaktan (SUPPORTED_FX_CURRENCIES,
 * iyileştirme 4.5) türetilir.
 */
type FxCurrency = SupportedFxCurrency;

/** Runtime type guard — kodu FxCurrency union'ına daraltır. */
function isFxCurrency(code: string): code is FxCurrency {
  return (SUPPORTED_FX_CURRENCIES as readonly string[]).includes(code);
}

/** Sıfır Decimal sabiti. */
const ZERO = new Prisma.Decimal(0);

export class LiveTradingProvider implements ITradingProvider {
  readonly mode: TradingMode = "LIVE";

  constructor(
    private readonly db: Prisma.TransactionClient | PrismaClientShim,
    /** DenizBank operasyonel istemcisi — tüm banka çağrıları buradan geçer. */
    private readonly bank: DenizBankBaseClient,
  ) {}

  /** Servisin transaction'ına katılım — PaperTradingProvider deseni. */
  private client(context?: ExecuteOrderContext): Prisma.TransactionClient | PrismaClientShim {
    return context?.tx ?? this.db;
  }

  // ----------------------------------------------------------
  // EXECUTE ORDER
  // ----------------------------------------------------------

  async executeOrder(
    request: ExecuteOrderRequest,
    context?: ExecuteOrderContext,
  ): Promise<ExecuteOrderResult> {
    const client = this.client(context);

    // --- Idempotency: bu emir için banka hareketi zaten varsa aynen döndür.
    const existing = await client.accountTransaction.findFirst({
      where: { orderId: request.orderId },
    });
    if (existing) {
      return this.rebuildResultFromTransaction(existing);
    }

    // --- Hisse senedi emirleri canlı modda desteklenmez (bankada endpoint yok).
    if (request.assetType === "STOCK") {
      return this.rejected(
        "LIVE_STOCK_NOT_SUPPORTED",
        "Canlı modda hisse senedi emirleri desteklenmiyor: DenizBank API Market " +
          "yalnızca döviz alım-satımı (ChangeExchange) sunar. Hisse işlemleri " +
          "için Sanal (PAPER) modu kullanın.",
        false,
      );
    }

    // --- Döviz cinsi doğrulaması: TRY karşı taraf, diğerleri işlem tarafı.
    if (request.currency === "TRY") {
      return this.rejected(
        "LIVE_TRY_NOT_TRADABLE",
        "Canlı modda işlem para birimi TRY olamaz; döviz cinsi (USD, EUR, ...) seçin.",
        false,
      );
    }
    if (!isFxCurrency(request.currency)) {
      return this.rejected(
        "LIVE_CURRENCY_NOT_SUPPORTED",
        `"${request.currency}" canlı modda desteklenmiyor. Desteklenen dövizler: ` +
          SUPPORTED_FX_CURRENCIES.join(", "),
        false,
      );
    }

    // --- LIVE hesabı seç (PAPER hesaplara asla dokunulmaz).
    const account = await client.account.findFirst({
      where: { accountType: "LIVE", currency: "TRY" },
      orderBy: { createdAt: "asc" },
    });
    if (!account || !account.bankAccountNumber) {
      return this.rejected(
        "LIVE_ACCOUNT_NOT_CONFIGURED",
        "Canlı işlem hesabı yapılandırılmamış: LIVE türünde ve banka hesap numarası " +
          "dolgu bir Account kaydı gerekir (bankAccountNumber alanı).",
        false,
      );
    }

    // --- Guard: güncel kur çek (bankaya gitmeden emri hazırla).
    let rates: GetCurrencyRateListShim;
    try {
      rates = await this.bank.getCurrencyRateList();
    } catch (error) {
      return this.fromBankError(error, "GetCurrencyRateList");
    }
    const rate = rates.CurrencyRateList.find(
      (r) => r.CurrencyCode === request.currency,
    );
    if (!rate) {
      return this.rejected(
        "LIVE_RATE_NOT_FOUND",
        `"${request.currency}" için banka kuru bulunamadı; emir bankaya gönderilmedi.`,
        true,
      );
    }

    // --- Tutar hesabı (Decimal — ADR-8):
    //  ALIM:  quantity = alınacak döviz tutarı; TL maliyeti = quantity × SellRate.
    //  SATIŞ: quantity = satılacak döviz tutarı; TL hasılatı = quantity × BuyRate.
    const quantity = request.quantity;
    if (quantity.lessThanOrEqualTo(0)) {
      return this.rejected(
        "LIVE_INVALID_QUANTITY",
        "İşlem miktarı sıfırdan büyük olmalıdır.",
        false,
      );
    }

    const tryAmount =
      request.side === "BUY"
        ? quantity.mul(new Prisma.Decimal(rate.SellRate))
        : quantity.mul(new Prisma.Decimal(rate.BuyRate));

    // --- Bakiye ön kontrolü (banka da kontrol eder; erken reddetme UX'i).
    if (request.side === "BUY") {
      const balance = await client.account.findFirst({
        where: { accountType: "LIVE", currency: "TRY" },
        orderBy: { createdAt: "asc" },
      });
      if (balance && balance.balance.lessThan(tryAmount)) {
        return this.rejected(
          "500201",
          "Hesap bakiyeniz bu işlem için yetersiz.",
          false,
        );
      }
    } else {
      const fxBalance = await client.account.findFirst({
        where: { accountType: "LIVE", currency: request.currency },
        orderBy: { createdAt: "asc" },
      });
      if (!fxBalance || fxBalance.balance.lessThan(quantity)) {
        return this.rejected(
          "500201",
          `"${request.currency}" bakiyeniz bu işlem için yetersiz.`,
          false,
        );
      }
    }

    // --- ChangeExchange parametreleri — asimetrinin TEK merkezi.
    const params = this.buildChangeExchangeParams({
      side: request.side,
      currency: request.currency,
      fxAmount: quantity,
      tryAmount,
      accountNumber: account.bankAccountNumber,
    });

    // --- Banka çağrısı.
    let exchange: ChangeExchangeShim;
    try {
      exchange = await this.bank.changeExchange(params);
    } catch (error) {
      return this.fromBankError(error, "ChangeExchange");
    }

    // --- Bakiye muhasebesi (aynı transaction içinde — ExecuteOrderContext.tx).
    await this.applyBalanceEffects(client, {
      side: request.side,
      currency: request.currency,
      fxAmount: quantity,
      tryAmount,
      tryAccountId: account.id,
      orderId: request.orderId,
      transactionId: exchange.TransactionID,
    });

    return {
      status: "FILLED",
      filledQuantity: quantity,
      filledValue: tryAmount,
      avgPrice: new Prisma.Decimal(
        request.side === "BUY" ? rate.SellRate : rate.BuyRate,
      ),
      commission: ZERO,
      transactionId: exchange.TransactionID,
      sessionId: exchange.SessionID,
      isRetryable: false,
      rawResponse: exchange,
    };
  }

  // ----------------------------------------------------------
  // ASİMETRİ KAPSÜLÜ — dokümandaki kritik iş kuralı
  // ----------------------------------------------------------

  /**
   * ChangeExchange parametre kurucu — alım/satış asimetrisinin TEK merkezi.
   *
   * Dokümandan (birebir):
   *  - SATIŞ: TransactionType = satılacak döviz, Amount = döviz tutarı,
   *           ConvertedAmount = TL karşılığı.
   *  - ALIM:  TransactionType = alınacak döviz, Amount = TL tutarı,
   *           ConvertedAmount = alınacak döviz tutarı.
   *
   * Bu kapsül dışında hiçbir kod Amount/ConvertedAmount anlamını bilmez.
   * verify-denizbank.ts iki yönü de ayrı ayrı doğrular.
   */
  private buildChangeExchangeParams(input: {
    side: "BUY" | "SELL";
    currency: FxCurrency;
    /** Döviz cinsinden işlem miktarı. */
    fxAmount: Prisma.Decimal;
    /** TL karşılığı. */
    tryAmount: Prisma.Decimal;
    /** İşlem yapılan banka hesap numarası. */
    accountNumber: string;
  }): ChangeExchangeParams {
    if (input.side === "BUY") {
      return {
        TransactionType: input.currency,
        Amount: Number(input.tryAmount.toFixed(2)),
        ConvertedAmount: Number(input.fxAmount.toFixed(2)),
        AccountId: input.accountNumber,
      };
    }
    return {
      TransactionType: input.currency,
      Amount: Number(input.fxAmount.toFixed(2)),
      ConvertedAmount: Number(input.tryAmount.toFixed(2)),
      AccountId: input.accountNumber,
    };
  }

  // ----------------------------------------------------------
  // BAKİYE MUHASEBESİ
  // ----------------------------------------------------------

  /**
   * Banka işlemi başarılıysa LIVE hesapların bakiyesini ve hareket kaydını
   * yazar — servisin transaction'ına katılır (ExecuteOrderContext.tx).
   */
  private async applyBalanceEffects(
    client: Prisma.TransactionClient | PrismaClientShim,
    input: {
      side: "BUY" | "SELL";
      currency: string;
      fxAmount: Prisma.Decimal;
      tryAmount: Prisma.Decimal;
      tryAccountId: string;
      orderId: string;
      transactionId: string;
    },
  ): Promise<void> {
    // --- TL hesap bakiyesi.
    const tryAccount = await client.account.findUnique({
      where: { id: input.tryAccountId },
    });
    if (tryAccount) {
      const delta = input.side === "BUY" ? input.tryAmount.neg() : input.tryAmount;
      const balanceAfter = tryAccount.balance.add(delta);
      await client.account.update({
        where: { id: tryAccount.id },
        data: { balance: balanceAfter, totalBalance: balanceAfter },
      });
      await client.accountTransaction.create({
        data: {
          accountId: tryAccount.id,
          orderId: input.orderId,
          type: input.side === "BUY" ? "BUY" : "SELL",
          currency: "TRY",
          amount: delta,
          balanceAfter,
          description:
            `Canlı ${input.side === "BUY" ? "alım" : "satım"}: ${input.fxAmount.toFixed(2)} ` +
            `${input.currency} @ ${input.transactionId}`,
        },
      });
    }

    // --- Döviz hesabı (varsa; yoksa ilk canlı döviz işlemi için oluşturulmaz —
    // bakiye senkronizasyonu GetAccountList ile yapılır; burada yalnızca
    // mevcut kayıt güncellenir).
    const fxAccount = await client.account.findFirst({
      where: { accountType: "LIVE", currency: input.currency },
      orderBy: { createdAt: "asc" },
    });
    if (fxAccount) {
      const delta = input.side === "BUY" ? input.fxAmount : input.fxAmount.neg();
      const balanceAfter = fxAccount.balance.add(delta);
      await client.account.update({
        where: { id: fxAccount.id },
        data: { balance: balanceAfter, totalBalance: balanceAfter },
      });
      await client.accountTransaction.create({
        data: {
          accountId: fxAccount.id,
          orderId: input.orderId,
          type: input.side === "BUY" ? "BUY" : "SELL",
          currency: input.currency,
          amount: delta,
          balanceAfter,
          description:
            `Canlı ${input.side === "BUY" ? "alım" : "satım"}: ${input.tryAmount.toFixed(2)} ` +
            `TL @ ${input.transactionId}`,
        },
      });
    }
  }

  // ----------------------------------------------------------
  // HATA EŞLEME
  // ----------------------------------------------------------

  /** Banka/istemci hatasını ExecuteOrderResult'a çevirir. */
  private fromBankError(error: unknown, endpoint: string): ExecuteOrderResult {
    if (error instanceof DenizBankClientError) {
      // --- Timeout / ağ: sonuç belirsiz → mutabakata bırak, asla FAILED.
      if (error.isTimeout || error.isNetworkError) {
        return {
          status: "PENDING_RECONCILIATION",
          filledQuantity: ZERO,
          filledValue: ZERO,
          errorCode: error.bankErrorCode ?? "TIMEOUT",
          errorMessage:
            `Banka çağrısı (${endpoint}) yanıt alınamadan kesildi; emir mutabakat ` +
            "için bekletiliyor. Nihai durum GetTransactionDetail ile doğrulanacak.",
          isRetryable: true,
        };
      }
      // --- DEFERRED: servis kapalı / mesai dışı → PENDING kal.
      if (error.errorClass === "DEFERRED") {
        return {
          status: "PENDING",
          filledQuantity: ZERO,
          filledValue: ZERO,
          errorCode: error.bankErrorCode,
          errorMessage: error.message,
          isRetryable: true,
        };
      }
      // --- PERMANENT: REJECTED (bakiye, limit, doğrulama, ...).
      if (error.errorClass === "PERMANENT") {
        return {
          status: "REJECTED",
          filledQuantity: ZERO,
          filledValue: ZERO,
          errorCode: error.bankErrorCode ?? "PERMANENT",
          errorMessage: error.message,
          isRetryable: false,
        };
      }
      // --- UNKNOWN: mutabakata bırak.
      return {
        status: "PENDING_RECONCILIATION",
        filledQuantity: ZERO,
        filledValue: ZERO,
        errorCode: error.bankErrorCode ?? "UNKNOWN",
        errorMessage: error.message,
        isRetryable: true,
      };
    }
    return {
      status: "PENDING_RECONCILIATION",
      filledQuantity: ZERO,
      filledValue: ZERO,
      errorCode: "UNEXPECTED",
      errorMessage:
        `Banka çağrısında (${endpoint}) beklenmedik hata: ` +
        (error instanceof Error ? error.message : String(error)),
      isRetryable: true,
    };
  }

  /** REJECTED sonuç kurucu — PaperTradingProvider deseni. */
  private rejected(errorCode: string, errorMessage: string, isRetryable: boolean): ExecuteOrderResult {
    return {
      status: "REJECTED",
      filledQuantity: ZERO,
      filledValue: ZERO,
      errorCode,
      errorMessage,
      isRetryable,
    };
  }

  /** Mevcut AccountTransaction kaydından idempotent sonuç kurar. */
  private rebuildResultFromTransaction(
    transaction: { amount: Prisma.Decimal; currency: string; type: string; description: string | null },
  ): ExecuteOrderResult {
    return {
      status: "FILLED",
      filledQuantity: transaction.amount.abs(),
      filledValue: transaction.amount.abs(),
      transactionId: transaction.description?.split("@").pop()?.trim() ?? undefined,
      isRetryable: false,
    };
  }

  // ----------------------------------------------------------
  // ITradingProvider — OKUMA YÖNTEMLERİ
  // ----------------------------------------------------------

  async getPositions(): Promise<ProviderPosition[]> {
    // Canlı modda pozisyonlar döviz bakiyeleridir; Portfolio tablosu hisse
    // pozisyonlarına özgüdür. Döviz bakiyeleri Account üzerinden sunulur.
    return [];
  }

  async getBalance(currency: CurrencyCode): Promise<BalanceInfo> {
    const account = await this.db.account.findFirst({
      where: { accountType: "LIVE", currency },
      orderBy: { createdAt: "asc" },
    });
    if (!account) {
      return { currency, available: ZERO, total: ZERO };
    }
    return {
      currency,
      available: account.balance,
      total: account.totalBalance,
    };
  }

  async getOrderStatus(
    transactionId: string,
    sessionId: string,
  ): Promise<ExecuteOrderResult> {
    try {
      const detail = await this.bank.getTransactionDetail({
        TransactionID: transactionId,
        SessionID: sessionId,
      });
      const isCompleted = detail.Status.toLowerCase() === "completed";
      return {
        status: isCompleted ? "FILLED" : "PENDING",
        filledQuantity: ZERO,
        filledValue: ZERO,
        transactionId: detail.TransactionID,
        errorCode: detail.ErrorCode,
        errorMessage: detail.ErrorDescription,
        isRetryable: !isCompleted,
        rawResponse: detail,
      };
    } catch (error) {
      return this.fromBankError(error, "GetTransactionDetail");
    }
  }

  async cancelOrder(_orderId: string): Promise<ExecuteOrderResult> {
    // DenizBank API Market'te ChangeExchange iptal endpoint'i yoktur;
    // işlem anlıktır. İptal isteği anlamlı TR hata ile reddedilir.
    return this.rejected(
      "LIVE_CANCEL_NOT_SUPPORTED",
      "Canlı döviz işlemleri anlık gerçekleşir; iptal desteklenmez.",
      false,
    );
  }

  async getCurrencyRates(): Promise<CurrencyRate[]> {
    try {
      const rates = await this.bank.getCurrencyRateList();
      const fetchedAt = new Date();
      return rates.CurrencyRateList.map((r) => ({
        base: r.CurrencyCode as CurrencyCode,
        quote: "TRY" as CurrencyCode,
        bid: new Prisma.Decimal(r.BuyRate),
        ask: new Prisma.Decimal(r.SellRate),
        fetchedAt,
      }));
    } catch {
      return [];
    }
  }

  async getHealth(): Promise<ProviderHealth> {
    try {
      await this.bank.getAccountList();
      return {
        mode: "LIVE",
        bankReachable: true,
        lastSuccessAt: new Date(),
      };
    } catch (error) {
      return {
        mode: "LIVE",
        bankReachable: false,
        lastError: {
          code: error instanceof DenizBankClientError ? (error.bankErrorCode ?? error.errorClass) : "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
          at: new Date(),
        },
      };
    }
  }
}

// ============================================================
// TİP SHIM'LERİ (Prisma tip genişletmelerinin okunabilir adları)
// ============================================================

/** PrismaClient veya TransactionClient — provider'ın DB erişim yüzeyi. */
type PrismaClientShim = typeof prisma;

type GetCurrencyRateListShim = Awaited<ReturnType<DenizBankBaseClient["getCurrencyRateList"]>>;
type ChangeExchangeShim = Awaited<ReturnType<DenizBankBaseClient["changeExchange"]>>;
