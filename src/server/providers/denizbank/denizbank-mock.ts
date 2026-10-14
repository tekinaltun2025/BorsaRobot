import { Prisma } from "@prisma/client";
import {
  extractErrorEnvelope,
  type ChangeExchangeParams,
  type DenizBankEnvelope,
} from "@/server/providers/denizbank/denizbank-contract";

/**
 * DenizBank mock transport — DENIZBANK_MOCK=true (veya AppKey tanımsız) iken
 * gerçek banka yerine bu katman çalışır.
 *
 * Tasarım hedefleri:
 *  1. Gerçekçi banka formatı: yanıtlar { Data: ... } zarfında, hatalar
 *     HTTP 200 + Data içinde ErrorCode/ErrorDescription olarak döner
 *     (dokümandaki "HTTP 200 ≠ başarı" kuralı birebir simüle edilir).
 *  2. Deterministik: aynı girdi → aynı yanıt (test edilebilirlik).
 *  3. İzole: mock durumları yalnızca bu modülün belleğinde yaşar; DB'ye
 *     yazılmaz, gerçek bankaya ağ isteği atılmaz.
 *  4. Test edilebilir hata enjeksiyonu: verify script'leri mock durumunu
 *     programatik olarak değiştirerek (failNextNetwork vb.) ağ hatası,
 *     banka hatası ve timeout senaryolarını simüle eder.
 *
 * Mock bakiyeler: mock hesaplar sabit bakiyeyle başlar; ChangeExchange
 * işlemleri bakiyeleri gerçekten düşürür/artırır — böylece E2E akış
 * (emir → bakiye değişimi → mutabakat) uçtan uca doğrulanabilir.
 */

/** Mock transport'un ağ katmanı sözleşmesi — fetch ile aynı imza. */
export type MockFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Mock banka hesabı — bellek içi durum. */
export interface MockBankAccount {
  AccountId: string;
  IBAN: string;
  CurrencyCode: string;
  AvailableBalance: number;
  TotalBalance: number;
  AccountName: string;
}

/** Mock kur — TL bazlı alış/satış. */
export interface MockCurrencyRate {
  CurrencyCode: string;
  BuyRate: number;
  SellRate: number;
}

/** Mock'un programatik hata enjeksiyonu — test senaryoları için. */
export interface MockFailurePlan {
  /** Kaç sonraki çağrı başarısız olsun (1 = hemen sonraki). */
  callsRemaining: number;
  /** "network" → fetch reddi; "bank" → HTTP 200 + ErrorCode; "timeout" → AbortError. */
  kind: "network" | "bank" | "timeout";
  /** kind="bank" iken döndürülecek ErrorCode. */
  bankErrorCode?: string;
  /** kind="bank" iken döndürülecek ErrorDescription. */
  bankErrorDescription?: string;
}

/** Mock ChangeExchange işlem kaydı — mutabakat testleri için. */
export interface MockExchangeRecord {
  TransactionID: string;
  SessionID: string;
  Status: string;
  TransactionType: string;
  Amount: number;
  ConvertedAmount: number;
  Rate: number;
  AccountId: string;
  createdAt: number;
}

/** Varsayılan mock hesaplar — her reset'te yeniden kurulur. */
function defaultAccounts(): MockBankAccount[] {
  return [
    {
      AccountId: "1234567",
      IBAN: "TR330006100519786457841326",
      CurrencyCode: "TRY",
      AvailableBalance: 50_000,
      TotalBalance: 50_000,
      AccountName: "BorsaRobot Canlı Test Hesabı",
    },
    {
      AccountId: "7654321",
      IBAN: "TR120006200119000006672315",
      CurrencyCode: "USD",
      AvailableBalance: 2_000,
      TotalBalance: 2_000,
      AccountName: "BorsaRobot Döviz Hesabı",
    },
  ];
}

/** Varsayılan mock kurlar — her reset'te yeniden kurulur. */
function defaultRates(): MockCurrencyRate[] {
  return [
    { CurrencyCode: "USD", BuyRate: 34.20, SellRate: 34.50 },
    { CurrencyCode: "EUR", BuyRate: 37.10, SellRate: 37.45 },
    { CurrencyCode: "GBP", BuyRate: 43.50, SellRate: 43.90 },
    { CurrencyCode: "CHF", BuyRate: 38.80, SellRate: 39.20 },
    { CurrencyCode: "JPY", BuyRate: 0.2290, SellRate: 0.2310 },
    { CurrencyCode: "AUD", BuyRate: 22.60, SellRate: 22.85 },
    { CurrencyCode: "CAD", BuyRate: 24.90, SellRate: 25.15 },
  ];
}

/**
 * DenizBank mock transport sınıfı.
 *
 * Kullanım: DenizBankBaseClient constructor'ına fetchFn olarak verilir.
 * Testler failNextNetwork()/failNextBankError() ile hata senaryoları
 * enjekte eder; getAccounts()/getRates()/getExchangeRecords()
 * erişimcileriyle mock durumunu doğrular.
 */
export class DenizBankMockTransport {
  private accounts: MockBankAccount[];
  private rates: MockCurrencyRate[];
  private exchangeRecords: MockExchangeRecord[] = [];
  private failurePlan: MockFailurePlan | null = null;
  private transactionCounter = 0;
  private sessionCounter = 0;

  constructor(options?: {
    initialAccounts?: MockBankAccount[];
    initialRates?: MockCurrencyRate[];
  }) {
    this.accounts = options?.initialAccounts ?? defaultAccounts();
    this.rates = options?.initialRates ?? defaultRates();
  }

  // ----------------------------------------------------------
  // Test erişimcileri
  // ----------------------------------------------------------

  /** Mock hesapların anlık kopyası. */
  getAccounts(): MockBankAccount[] {
    return this.accounts.map((a) => ({ ...a }));
  }

  /** Mock kur listesinin anlık kopyası. */
  getRates(): MockCurrencyRate[] {
    return this.rates.map((r) => ({ ...r }));
  }

  /** Gerçekleşen ChangeExchange kayıtları. */
  getExchangeRecords(): MockExchangeRecord[] {
    return this.exchangeRecords.map((r) => ({ ...r }));
  }

  /** Sonraki N çağrıyı ağ hatasıyla (fetch reddi) başarısız kılar. */
  failNextNetwork(calls: number): void {
    this.failurePlan = { callsRemaining: calls, kind: "network" };
  }

  /** Sonraki N çağrıyı timeout (AbortError) ile başarısız kılar. */
  failNextTimeout(calls: number): void {
    this.failurePlan = { callsRemaining: calls, kind: "timeout" };
  }

  /** Sonraki N çağrıyı banka hatasıyla (HTTP 200 + ErrorCode) başarısız kılar. */
  failNextBankError(calls: number, errorCode: string, description?: string): void {
    this.failurePlan = {
      callsRemaining: calls,
      kind: "bank",
      bankErrorCode: errorCode,
      bankErrorDescription: description,
    };
  }

  /** Hata enjeksiyon planını temizler. */
  clearFailurePlan(): void {
    this.failurePlan = null;
  }

  /** Mock durumunu sıfırlar (bakiyeler, kayıtlar, hata planı). */
  reset(): void {
    this.accounts = defaultAccounts();
    this.rates = defaultRates();
    this.exchangeRecords = [];
    this.failurePlan = null;
    this.transactionCounter = 0;
    this.sessionCounter = 0;
  }

  // ----------------------------------------------------------
  // Transport (fetch imzalı)
  // ----------------------------------------------------------

  /** fetch imzalı mock çağrı — BaseClient'e enjekte edilir. */
  readonly fetchImpl: MockFetch = async (url, init) => {
    // --- Hata enjeksiyonu (test senaryoları). Plan varken her çağrı
    // planın türüne göre başarısız olur; sayaç bitince plan düşer.
    const plan = this.failurePlan;
    if (plan !== null) {
      plan.callsRemaining -= 1;
      if (plan.callsRemaining <= 0) {
        this.failurePlan = null;
      }
      if (plan.kind === "network") {
        throw new TypeError("fetch failed — mock ağ hatası");
      }
      if (plan.kind === "timeout") {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          Data: {
            ErrorCode: plan.bankErrorCode ?? "500201",
            ErrorDescription: plan.bankErrorDescription,
          },
        }),
      };
    }

    const body = JSON.parse(init.body) as DenizBankEnvelope<Record<string, unknown>>;
    const endpoint = url.split("/").pop() ?? "";
    const parameters = body.Parameters[0] ?? {};

    const data = this.handleEndpoint(endpoint, parameters);
    return {
      ok: true,
      status: 200,
      json: async () => ({ Data: data }),
    };
  };

  // ----------------------------------------------------------
  // Endpoint işleyicileri
  // ----------------------------------------------------------

  private handleEndpoint(
    endpoint: string,
    parameters: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (endpoint) {
      case "GetAccountList":
        return {
          AccountList: this.accounts.map((a) => ({ ...a })),
        };
      case "GetAccountDetail": {
        const accountId = String(parameters["AccountId"] ?? "");
        const account = this.accounts.find((a) => a.AccountId === accountId);
        if (!account) {
          return { ErrorCode: "201001", ErrorDescription: "Account not found" };
        }
        return { ...account };
      }
      case "GetCurrencyRateList":
        return {
          CurrencyRateList: this.rates.map((r) => ({ ...r })),
        };
      case "ChangeExchange":
        return this.handleChangeExchange(parameters);
      case "GetTransactionDetail": {
        const transactionId = String(parameters["TransactionID"] ?? "");
        const record = this.exchangeRecords.find(
          (r) => r.TransactionID === transactionId,
        );
        if (!record) {
          return { ErrorCode: "201001", ErrorDescription: "Transaction not found" };
        }
        return {
          TransactionID: record.TransactionID,
          SessionID: record.SessionID,
          Status: record.Status,
          Amount: record.Amount,
          ConvertedAmount: record.ConvertedAmount,
        };
      }
      default:
        return {
          ErrorCode: "201001",
          ErrorDescription: `Unknown endpoint: ${endpoint}`,
        };
    }
  }

  /**
   * ChangeExchange işleyici — dokümandaki yön asimetrisini birebir uygular:
   *  - SATIŞ: Amount = döviz tutarı, ConvertedAmount = TL karşılığı.
   *  - ALIM:  Amount = TL tutarı, ConvertedAmount = alınacak döviz tutarı.
   *
   * Yön çıkarımı (mock tarafında): Amount > ConvertedAmount → ALIM.
   * Gerekçe: 1 birim döviz > 1 TL olduğundan TL tutarı her zaman döviz
   * tutarından büyüktür (kurlar > 1). Bu çıkarım yalnızca mock'un bakiye
   * muhasebesi içindir; üretimde yön LiveTradingProvider'dan açıkça gelir.
   */
  private handleChangeExchange(parameters: Record<string, unknown>): Record<string, unknown> {
    const transactionType = String(parameters["TransactionType"] ?? "");
    const amount = Number(parameters["Amount"] ?? 0);
    const convertedAmount = Number(parameters["ConvertedAmount"] ?? 0);
    const accountId = String(parameters["AccountId"] ?? "");

    const rate = this.rates.find((r) => r.CurrencyCode === transactionType);
    if (!rate) {
      return {
        ErrorCode: "201001",
        ErrorDescription: `Unknown currency: ${transactionType}`,
      };
    }

    const tryAccount = this.accounts.find(
      (a) => a.AccountId === accountId && a.CurrencyCode === "TRY",
    );
    if (!tryAccount) {
      return { ErrorCode: "201001", ErrorDescription: "TRY account not found" };
    }

    // Yön çıkarımı: Amount > ConvertedAmount → ALIM (Amount=TL, ConvertedAmount=döviz).
    const isBuy = amount > convertedAmount;

    if (isBuy) {
      // ALIM: TL hesaptan Amount düşer; ConvertedAmount kadar döviz eklenir.
      if (tryAccount.AvailableBalance < amount) {
        return {
          ErrorCode: "500201",
          ErrorDescription: "Your account balance is insufficient",
        };
      }
      tryAccount.AvailableBalance -= amount;
      tryAccount.TotalBalance -= amount;
      const fxAccount = this.accounts.find(
        (a) => a.CurrencyCode === transactionType,
      );
      if (fxAccount) {
        fxAccount.AvailableBalance += convertedAmount;
        fxAccount.TotalBalance += convertedAmount;
      }
    } else {
      // SATIŞ: döviz hesaptan Amount düşer; ConvertedAmount kadar TL eklenir.
      const fxAccount = this.accounts.find(
        (a) => a.CurrencyCode === transactionType,
      );
      if (!fxAccount || fxAccount.AvailableBalance < amount) {
        return {
          ErrorCode: "500201",
          ErrorDescription: "Your account balance is insufficient",
        };
      }
      fxAccount.AvailableBalance -= amount;
      fxAccount.TotalBalance -= amount;
      tryAccount.AvailableBalance += convertedAmount;
      tryAccount.TotalBalance += convertedAmount;
    }

    this.transactionCounter += 1;
    this.sessionCounter += 1;
    const record: MockExchangeRecord = {
      TransactionID: `MOCKTX${String(this.transactionCounter).padStart(6, "0")}`,
      SessionID: `MOCKSS${String(this.sessionCounter).padStart(6, "0")}`,
      Status: "Completed",
      TransactionType: transactionType,
      Amount: amount,
      ConvertedAmount: convertedAmount,
      Rate: isBuy ? rate.SellRate : rate.BuyRate,
      AccountId: accountId,
      createdAt: Date.now(),
    };
    this.exchangeRecords.push(record);

    return {
      TransactionID: record.TransactionID,
      SessionID: record.SessionID,
      Status: record.Status,
      Amount: record.Amount,
      ConvertedAmount: record.ConvertedAmount,
      Rate: record.Rate,
    };
  }
}

/**
 * Mock transport'u fetch benzeri imzaya bağlar.
 * BaseClient'in transport bağımlılığı bu tiptedir.
 */
export function createMockFetch(transport: DenizBankMockTransport): MockFetch {
  return transport.fetchImpl;
}

/** Mock yanıtının hata zarfı taşıyıp taşımadığını söyler — test yardımcısı. */
export function mockResponseHasError(data: unknown): boolean {
  return extractErrorEnvelope(data) !== null;
}

/** Mock ChangeExchange parametrelerinin yön asimetrisine göre ayrıştırır. */
export function assertMockChangeExchangeAsymmetry(params: ChangeExchangeParams): {
  isBuy: boolean;
  tryAmount: Prisma.Decimal;
  fxAmount: Prisma.Decimal;
} {
  const isBuy = params.Amount > params.ConvertedAmount;
  return {
    isBuy,
    tryAmount: isBuy
      ? new Prisma.Decimal(params.Amount)
      : new Prisma.Decimal(params.ConvertedAmount),
    fxAmount: isBuy
      ? new Prisma.Decimal(params.ConvertedAmount)
      : new Prisma.Decimal(params.Amount),
  };
}
