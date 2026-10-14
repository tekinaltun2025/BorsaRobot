import type { Prisma } from "@prisma/client";
import type {
  CurrencyCode,
  OrderSide,
  OrderStatus,
  TradingMode,
} from "@/lib/types";

/**
 * Ticaret sağlayıcı sözleşmesi — Strategy Pattern (ADR-2, Bölüm 4.2).
 *
 * İki implementasyon:
 *  - PaperTradingProvider: DB üzerinde simülasyon, sıfır dış çağrı.
 *  - LiveTradingProvider:  DenizBank API Market üzerinden gerçek işlem (Faz 5+).
 *
 * INVARIANT'LAR (her implementasyon bu kurallara uyar):
 *  1. executeOrder() asla Order tablosunun durumunu doğrudan YAZMAZ;
 *     sonucu döner, durum güncellemesi TradingService'in sorumluluğudur.
 *  2. executeOrder() idempotent'tir: aynı clientRequestId ile ikinci çağrı
 *     ilk sonucu (veya "zaten işlendi" bilgisini) döner, yeni işlem üretmez.
 *  3. Belirsiz sonuçta (timeout) status = PENDING_RECONCILIATION döner;
 *     asla FAILED dönmez — nihai karar mutabakat servisine aittir.
 *  4. Tüm parasal alanlar Prisma.Decimal'dır; Number'a çevrim yapılmaz (ADR-8).
 */

/** Emir gerçekleştirme isteği — TradingService → Provider arası sözleşme. */
export interface ExecuteOrderRequest {
  /** Order tablosundaki kayıt — provider yalnızca okur, durumunu kendisi yazmaz. */
  orderId: string;
  /** Idempotency anahtarı: aynı emrin tekrar gönderilmesini önler (ADR-7). */
  clientRequestId: string;
  side: OrderSide;
  /** Varlık türü — Faz 2'de yalnızca STOCK. */
  assetType: "STOCK" | "CURRENCY";
  /** Hisse sembolü (örn. "THYAO"). */
  symbol: string;
  /** İşlem gören miktar (hisse adedi — tamsayı lot). */
  quantity: Prisma.Decimal;
  /** Emrin verildiği para birimi (hisse: TRY). */
  currency: CurrencyCode;
  /** Beklenen fiyat — bilgilendirme amaçlı; sapma guard'ında kullanılır. */
  limitPrice?: Prisma.Decimal;
  /** Emri üreten analiz kaydı (varsa) — izlenebilirlik için provider'a taşınır. */
  analysisLogId?: string;
}

/** Emir gerçekleştirme sonucu — provider'dan servise dönen sözleşme. */
export interface ExecuteOrderResult {
  /** Nihai durum makinesi güncellemesi. */
  status: OrderStatus;
  /** Gerçekleşen miktar (slippage olabilir). */
  filledQuantity: Prisma.Decimal;
  /** Gerçekleşen toplam tutar (quantity × fiyat + masraflar). */
  filledValue: Prisma.Decimal;
  /** Birim gerçekleşme fiyatı. */
  avgPrice?: Prisma.Decimal;
  /** İşlem komisyonu (TL). */
  commission?: Prisma.Decimal;
  /** Satış işleminde net kâr/zarar (komisyon dahil; yalnızca SELL). */
  realizedPnl?: Prisma.Decimal;
  /** İşlem referansı — mutabakat ve dekont için. */
  transactionId?: string;
  /** DenizBank ChannelSessionId — GetTransactionDetail mutabakatı için. */
  sessionId?: string;
  /** Banka/istekci hata kodu (örn. 500201 bakiye yetersiz). */
  errorCode?: string;
  /** Hata mesajı — kullanıcıya gösterilecek haliyle (TR). */
  errorMessage?: string;
  /** Kalıcı hata mı (retry anlamsız) yoksa geçici mi? */
  isRetryable: boolean;
  /** Ham yanıt — ApiCallLog'a yazılmak üzere (canlı modda). */
  rawResponse?: unknown;
}

/** Sağlayıcıdan çekilebilen bakiye bilgisi. */
export interface BalanceInfo {
  /** Para birimi. */
  currency: CurrencyCode;
  /** Kullanılabilir bakiye (bloke hariç). */
  available: Prisma.Decimal;
  /** Toplam bakiye (bloke dahil). */
  total: Prisma.Decimal;
}

/** Kur bilgisi — normalize edilmiş hali (canlı modda GetCurrencyRateList'ten). */
export interface CurrencyRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  /** Alış kuru. */
  bid: Prisma.Decimal;
  /** Satış kuru. */
  ask: Prisma.Decimal;
  fetchedAt: Date;
}

/** Sağlayıcı sağlık durumu — admin paneli göstergesi. */
export interface ProviderHealth {
  mode: TradingMode;
  /** Son başarılı çağrı zamanı. */
  lastSuccessAt?: Date;
  /** Son hata (varsa). */
  lastError?: { code: string; message: string; at: Date };
  /** Canlı modda banka erişilebilirliği; paper modda her zaman true. */
  bankReachable?: boolean;
}

/**
 * Emir gerçekleştirme bağlamı — servisin açık transaction'ına katılım için.
 *
 * TradingService emri tek bir Prisma $transaction içinde işler; provider
 * bakiye/pozisyon/hareket yazımlarını AYNI transaction'a bu istemci üzerinden
 * yazar. Böylece "bakiye düştü ama emir kaydedilmedi" tutarsızlığı imkânsızlaşır.
 * tx verilmezse provider kendi atomik transaction'ını açar.
 */
export interface ExecuteOrderContext {
  tx?: Prisma.TransactionClient;
}

/** Sağlayıcıdan çekilebilen pozisyon görünümü (getPositions sözleşmesi). */
export interface ProviderPosition {
  /** İlişkili Stock kayıt id'si. */
  stockId: string;
  /** Hisse sembolü. */
  symbol: string;
  /** Pozisyondaki adet. */
  quantity: Prisma.Decimal;
  /** Adet başına ortalama maliyet. */
  avgCost: Prisma.Decimal;
  /** Toplam maliyet (quantity × avgCost). */
  totalCost: Prisma.Decimal;
}

export interface ITradingProvider {
  /** Sağlayıcının çalıştırdığı mod. */
  readonly mode: TradingMode;

  /**
   * Emri gerçekleştirir.
   * Paper modda: DB transaction içinde anlık FILLED simülasyonu.
   * Live modda: guard zinciri (limit→kur→KGV) + ChangeExchange + mutabakat.
   */
  executeOrder(
    request: ExecuteOrderRequest,
    context?: ExecuteOrderContext,
  ): Promise<ExecuteOrderResult>;

  /** Açık pozisyonları döndürür. */
  getPositions(): Promise<ProviderPosition[]>;

  /** Belirtilen para biriminde kullanılabilir bakiyeyi döner. */
  getBalance(currency: CurrencyCode): Promise<BalanceInfo>;

  /**
   * Emrin işlem tarafındaki nihai durumunu sorgular.
   * Paper modda: DB'den okur (her zaman kesin).
   * Live modda: GetTransactionDetail (TransactionID + SessionID) çağırır.
   */
  getOrderStatus(transactionId: string, sessionId: string): Promise<ExecuteOrderResult>;

  /**
   * Bekleyen (henüz nihai duruma gelmemiş) emri iptal eder.
   * FILLED emirler iptal edilemez (Bölüm 3.5: FILLED → CANCELLED yasaktır).
   */
  cancelOrder(orderId: string): Promise<ExecuteOrderResult>;

  /** Güncel kur listesini döner (döviz işlemleri için). */
  getCurrencyRates(): Promise<CurrencyRate[]>;

  /** Sağlayıcı sağlık göstergesi — admin paneli ve cron denetimi için. */
  getHealth(): Promise<ProviderHealth>;
}
