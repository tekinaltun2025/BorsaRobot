import type { ZodType } from "zod";
import type { DenizBankErrorClass } from "@/lib/types";
import { logApiCall, type ApiCallLogEntry } from "@/server/services/api-log-service";
import {
  bankErrorMessage,
  classifyBankError,
  extractErrorEnvelope,
  maskAppKey,
  changeExchangeParamsSchema,
  emptyParamsSchema,
  getAccountDetailParamsSchema,
  getTransactionDetailParamsSchema,
  getAccountListDataSchema,
  getAccountDetailDataSchema,
  changeExchangeDataSchema,
  getCurrencyRateListDataSchema,
  getTransactionDetailDataSchema,
  type ChangeExchangeData,
  type ChangeExchangeParams,
  type DenizBankEnvelope,
  type GetAccountDetailData,
  type GetAccountDetailParams,
  type GetAccountListData,
  type GetCurrencyRateListData,
  type GetTransactionDetailData,
  type GetTransactionDetailParams,
} from "@/server/providers/denizbank/denizbank-contract";
import {
  DenizBankMockTransport,
  type MockFetch,
} from "@/server/providers/denizbank/denizbank-mock";

/**
 * DenizBank API Market generic istemcisi (Bölüm 4.6).
 *
 * Sözleşme kuralları (docs/DenizBank API Market Download.txt):
 *  - Tüm endpoint'ler POST + application/json.
 *  - Her istek: { Header: {...}, Parameters: [ ... ] } zarfı.
 *  - Header: AppKey (env), Channel="API", ChannelSessionId (taze GUID),
 *    ChannelRequestId (taze GUID) — "Her istekte farklı GUID değerler
 *    girilmeli" kuralı; crypto.randomUUID() ile üretilir, asla cache'lenmez.
 *  - Yanıt: HTTP 200 + { Data: object } — HTTP 200 ≠ başarı; Data içindeki
 *    ErrorCode denetlenir.
 *
 * Retry politikası (Bölüm 2.3):
 *  - Yalnızca TRANSIENT sınıfı (ağ hatası, timeout, HTTP 5xx, 201003,
 *    errResponse/errLoad) yeniden denenir — varsayılan 1 retry.
 *  - RETRY'DE ChannelRequestId KORUNUR: banka ilk isteği işlediyse ikinci
 *    deneme aynı istek olarak tanınır ve çift para hareketi imkânsızlaşır.
 *    ChannelSessionId ise her denemede taze üretilir (oturum başına GUID
 *    kuralı). Bu, dokümandaki GUID kuralıyla idempotency gereğinin uzlaşmasıdır.
 *  - PERMANENT (bakiye/limit/doğrulama) ve DEFERRED (90012/90020) asla
 *    retry edilmez.
 *
 * Timeout: AbortController ile — varsayılan 30 sn; para hareketi içeren
 * çağrılarda (isMoneyMovement) 45 sn.
 *
 * Denetim izi: her deneme ham istek/yanıtıyla ApiCallLog'a yazılır
 * (AppKey maskeli — ADR-3). Log yazımı best-effort'tır; başarısız olursa
 * ana akış bozulmaz.
 */

// ============================================================
// YAPILANDIRMA
// ============================================================

/** BaseClient yapılandırması — factory env'den doldurur. */
export interface DenizBankClientConfig {
  /** Banka temel URL'i — DENIZBANK_BASE_URL env'inden. */
  baseUrl: string;
  /** Uygulama anahtarı — DENIZBANK_APP_KEY env'inden. Asla koda gömülmez. */
  appKey: string;
  /** Standart istek timeout'u (ms) — varsayılan 30.000. */
  timeoutMs?: number;
  /** Para hareketi içeren çağrılar için timeout (ms) — varsayılan 45.000. */
  moneyMovementTimeoutMs?: number;
  /** TRANSIENT hatalarda maksimum ek deneme sayısı — varsayılan 1. */
  maxRetries?: number;
  /** Mock mod zorlaması — true ise gerçek ağ çağrısı asla yapılmaz. */
  mock?: boolean;
}

/** Dış bağımlılıklar — test edilebilirlik için enjekte edilir. */
export interface DenizBankClientDeps {
  /** Ham istek/yanıt kaydı — ApiCallLog tablosuna yazar. */
  logApiCall?: (entry: ApiCallLogEntry) => Promise<void>;
  /** Ağ katmanı — mock transport veya global fetch. */
  fetchFn?: MockFetch;
}

// ============================================================
// HATA TİPLERİ
// ============================================================

/**
 * DenizBank çağrı hatası — sınıflandırılmış, servis katmanının karar
 * vermesine hazır biçimde taşınır.
 */
export class DenizBankClientError extends Error {
  /** Banka hata kodu (Data içindeki ErrorCode) — varsa. */
  readonly bankErrorCode?: string;
  /** HTTP durum kodu — yanıt alındıysa. */
  readonly httpStatus?: number;
  /** Ağ katmanı hatası mı (yanıt hiç alınamadı). */
  readonly isNetworkError: boolean;
  /** Timeout (AbortError) mı. */
  readonly isTimeout: boolean;
  /** Zod doğrulama hatası detayı — varsa. */
  readonly validationError?: string;

  constructor(
    message: string,
    readonly errorClass: DenizBankErrorClass,
    options: {
      bankErrorCode?: string;
      httpStatus?: number;
      isNetworkError?: boolean;
      isTimeout?: boolean;
      validationError?: string;
    } = {},
  ) {
    super(message);
    this.name = "DenizBankClientError";
    this.bankErrorCode = options.bankErrorCode;
    this.httpStatus = options.httpStatus;
    this.isNetworkError = options.isNetworkError ?? false;
    this.isTimeout = options.isTimeout ?? false;
    this.validationError = options.validationError;
  }
}

// ============================================================
// İSTEMCİ
// ============================================================

/** Varsayılan timeout'lar (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MONEY_TIMEOUT_MS = 45_000;

/** Retry denemeleri arası bekleme tabanı (ms) — jitter'lı exponential. */
const RETRY_BACKOFF_BASE_MS = 1_000;

export class DenizBankBaseClient {
  private readonly config: Required<Pick<DenizBankClientConfig, "baseUrl" | "appKey" | "timeoutMs" | "moneyMovementTimeoutMs" | "maxRetries">> & {
    mock: boolean;
  };
  private readonly logApiCallFn: (entry: ApiCallLogEntry) => Promise<void>;
  private readonly fetchFn: MockFetch;
  /** Mock transport (mock modda hata enjeksiyonu/test erişimi için exposed). */
  readonly mockTransport: DenizBankMockTransport | null;
  /**
   * Fire-and-forget ApiCallLog yazım kuyruğu. Banka çağrıları bir Prisma
   * interactive transaction içindeyken log yazımının await edilmesi SQLite
   * yazma kilidinde karşılıklı bekleme (deadlock) yaratır; yazımlar bu
   * kuyruğa atılır ve transaction dışında tamamlanır.
   */
  private pendingLogWrites: Promise<void>[] = [];

  constructor(config: DenizBankClientConfig, deps: DenizBankClientDeps = {}) {
    if (config.baseUrl.trim() === "" && !config.mock) {
      throw new DenizBankClientError(
        "DENIZBANK_BASE_URL tanımlı değil. Canlı mod için banka temel adresini .env dosyasında ayarlayın.",
        "PERMANENT",
      );
    }
    if (config.appKey.trim() === "" && !config.mock) {
      throw new DenizBankClientError(
        "DENIZBANK_APP_KEY tanımlı değil. Canlı mod için bankadan aldığınız AppKey'i .env dosyasında ayarlayın.",
        "PERMANENT",
      );
    }

    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      appKey: config.appKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      moneyMovementTimeoutMs:
        config.moneyMovementTimeoutMs ?? DEFAULT_MONEY_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? 1,
      mock: config.mock ?? false,
    };

    this.logApiCallFn = deps.logApiCall ?? logApiCall;

    if (this.config.mock) {
      this.mockTransport = new DenizBankMockTransport();
      this.fetchFn = deps.fetchFn ?? this.mockTransport.fetchImpl;
    } else {
      this.mockTransport = null;
      this.fetchFn =
        deps.fetchFn ??
        (async (input: string, init: Parameters<MockFetch>[1]) => {
          const response = await fetch(input, {
            method: init.method,
            headers: init.headers,
            body: init.body,
            signal: init.signal,
          });
          return {
            ok: response.ok,
            status: response.status,
            json: () => response.json(),
          };
        });
    }
  }

  /** İstemcinin mock modda mı çalıştığı. */
  get isMockMode(): boolean {
    return this.config.mock;
  }

  // ----------------------------------------------------------
  // ÇEKİRDEK: call()
  // ----------------------------------------------------------

  /**
   * Endpoint çağrısı — tüm tip güvenliği, GUID üretimi, timeout, retry ve
   * hata sınıflandırma burada merkezîleşir.
   *
   * @param endpoint       URL segmenti (örn. "GetAccountList").
   * @param paramsSchema   Parameters dizisi öğelerinin Zod şeması.
   * @param responseSchema Data alanının Zod şeması.
   * @param parameters     Gönderilecek parametre nesneleri (dizi).
   * @param options         isMoneyMovement: timeout uzar; disableRetry.
   * @returns Doğrulanmış Data içeriği (TData).
   * @throws DenizBankClientError — sınıflandırılmış hata.
   */
  async call<TParams, TData>(
    endpoint: string,
    paramsSchema: ZodType<TParams>,
    responseSchema: ZodType<TData>,
    parameters: TParams[],
    options?: { isMoneyMovement?: boolean; disableRetry?: boolean },
  ): Promise<TData> {
    // --- İstek parametreleri Zod ile doğrulanır (istek bankaya gitmeden).
    const validatedParams: TParams[] = [];
    for (const parameter of parameters) {
      const parsed = paramsSchema.safeParse(parameter);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new DenizBankClientError(
          `DenizBank istek parametreleri geçersiz (${endpoint}): ${detail}`,
          "PERMANENT",
          { validationError: detail },
        );
      }
      validatedParams.push(parsed.data);
    }

    const maxAttempts = options?.disableRetry
      ? 1
      : 1 + Math.max(0, this.config.maxRetries);
    const timeoutMs = options?.isMoneyMovement
      ? this.config.moneyMovementTimeoutMs
      : this.config.timeoutMs;

    // --- ChannelRequestId: TÜM denemelerde KORUNUR (idempotent retry —
    // banka ilk isteği işlediyse retry aynı işlem olarak tanınır, çift
    // para hareketi imkânsızlaşır). İlk üretim crypto.randomUUID() ile.
    const channelRequestId = crypto.randomUUID();

    let lastError: DenizBankClientError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // --- ChannelSessionId: HER denemede taze üretilir (doküman kuralı).
      const envelope: DenizBankEnvelope<TParams> = {
        Header: {
          AppKey: this.config.appKey,
          Channel: "API",
          ChannelSessionId: crypto.randomUUID(),
          ChannelRequestId: channelRequestId,
        },
        Parameters: validatedParams,
      };

      const requestBody = JSON.stringify(envelope);
      const startedAt = Date.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: Awaited<ReturnType<MockFetch>>;
        try {
          response = await this.fetchFn(`${this.config.baseUrl}/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        // --- HTTP 5xx: transient — retry adayı.
        if (response.status >= 500) {
          throw new DenizBankClientError(
            `DenizBank sunucusu hata döndürdü (HTTP ${response.status}, ${endpoint}).`,
            "TRANSIENT",
            { httpStatus: response.status },
          );
        }

        // --- HTTP 4xx: kalıcı — retry anlamsız.
        if (!response.ok) {
          throw new DenizBankClientError(
            `DenizBank isteği reddetti (HTTP ${response.status}, ${endpoint}).`,
            "PERMANENT",
            { httpStatus: response.status },
          );
        }

        // --- Yanıt gövdesi: { Data: ... } — HTTP 200 ≠ başarı.
        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          throw new DenizBankClientError(
            `DenizBank yanıtı geçerli JSON değil (${endpoint}).`,
            "UNKNOWN",
            { httpStatus: response.status },
          );
        }

        const data =
          typeof raw === "object" && raw !== null && "Data" in raw
            ? (raw as { Data: unknown }).Data
            : null;
        if (data === null) {
          throw new DenizBankClientError(
            `DenizBank yanıtında Data alanı eksik (${endpoint}).`,
            "UNKNOWN",
            { httpStatus: response.status },
          );
        }

        // --- Data içinde hata zarfı var mı? (HTTP 200 ≠ başarı kuralı)
        const errorEnvelope = extractErrorEnvelope(data);
        if (errorEnvelope !== null) {
          const errorClass = classifyBankError(
            errorEnvelope.ErrorCode,
            errorEnvelope.ErrorDescription,
          );
          throw new DenizBankClientError(
            bankErrorMessage(errorEnvelope.ErrorCode, errorEnvelope.ErrorDescription),
            errorClass,
            {
              bankErrorCode: errorEnvelope.ErrorCode,
              httpStatus: response.status,
            },
          );
        }

        // --- Başarı: Data'yı endpoint şemasıyla doğrula (ADR-9).
        const parsedData = responseSchema.safeParse(data);
        if (!parsedData.success) {
          const detail = parsedData.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new DenizBankClientError(
            `DenizBank yanıt şeması beklenmedik (${endpoint}): ${detail}`,
            "UNKNOWN",
            { httpStatus: response.status, validationError: detail },
          );
        }

        // --- Başarılı çağrıyı logla (AppKey maskeli) ve dön.
        //     Yazım fire-and-forget: banka çağrısı bir DB transaction
        //     içindeyken burada await etmek SQLite kilidinde deadlock yaratır.
        this.writeLog({
          endpoint,
          requestBody: this.maskRequestBody(requestBody),
          responseBody: JSON.stringify(raw),
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
        });
        return parsedData.data;
      } catch (error) {
        const clientError = this.toClientError(error, endpoint);
        lastError = clientError;

        // --- Her başarısız deneme loglanır (denetim izi) — fire-and-forget.
        this.writeLog({
          endpoint,
          requestBody: this.maskRequestBody(requestBody),
          responseBody: JSON.stringify({
            error: clientError.message,
            bankErrorCode: clientError.bankErrorCode ?? null,
          }),
          httpStatus: clientError.httpStatus ?? null,
          errorClass: clientError.errorClass,
          errorCode: clientError.bankErrorCode ?? null,
          durationMs: Date.now() - startedAt,
        });

        // --- Retry yalnızca TRANSIENT'te ve deneme hakkı varken.
        const canRetry =
          clientError.errorClass === "TRANSIENT" &&
          attempt < maxAttempts - 1;
        if (!canRetry) {
          throw clientError;
        }
        await this.backoff(attempt);
      }
    }

    // Buraya düşmek mümkün değil (döngü ya döner ya fırlatır) — TS için guard.
    throw (
      lastError ??
      new DenizBankClientError(
        `DenizBank çağrısı beklenmedik biçimde sonlandı (${endpoint}).`,
        "UNKNOWN",
      )
    );
  }

  // ----------------------------------------------------------
  // ENDPOINT METOTLARI — tip güvenli ince katman
  // ----------------------------------------------------------

  /** POST /GetAccountList — hesap listesi (bakiye senkronizasyonu). */
  async getAccountList(): Promise<GetAccountListData> {
    return this.call(
      "GetAccountList",
      emptyParamsSchema,
      getAccountListDataSchema,
      [{}],
    );
  }

  /** POST /GetAccountDetail — tek hesap detayı. */
  async getAccountDetail(params: GetAccountDetailParams): Promise<GetAccountDetailData> {
    return this.call(
      "GetAccountDetail",
      getAccountDetailParamsSchema,
      getAccountDetailDataSchema,
      [params],
    );
  }

  /** POST /GetCurrencyRateList — güncel kur listesi (guard zinciri). */
  async getCurrencyRateList(): Promise<GetCurrencyRateListData> {
    return this.call(
      "GetCurrencyRateList",
      emptyParamsSchema,
      getCurrencyRateListDataSchema,
      [{}],
    );
  }

  /**
   * POST /ChangeExchange — döviz alım-satımı (tek gerçek para hareketi).
   *
   * KRİTİK: Amount/ConvertedAmount yön asimetrisi ÇAĞIRAN tarafa aittir
   * (LiveTradingProvider.buildChangeExchangeParams); bu metot yalnızca
   * sözleşmeye uygun iletimi sağlar. Para hareketi → 45 sn timeout.
   */
  async changeExchange(params: ChangeExchangeParams): Promise<ChangeExchangeData> {
    return this.call(
      "ChangeExchange",
      changeExchangeParamsSchema,
      changeExchangeDataSchema,
      [params],
      { isMoneyMovement: true },
    );
  }

  /** POST /GetTransactionDetail — TransactionID + SessionID mutabakatı. */
  async getTransactionDetail(
    params: GetTransactionDetailParams,
  ): Promise<GetTransactionDetailData> {
    return this.call(
      "GetTransactionDetail",
      getTransactionDetailParamsSchema,
      getTransactionDetailDataSchema,
      [params],
    );
  }

  // ----------------------------------------------------------
  // İÇ YARDIMCILAR
  // ----------------------------------------------------------

  /** Beklenmeyen hatayı DenizBankClientError'a normalize eder. */
  private toClientError(error: unknown, endpoint: string): DenizBankClientError {
    if (error instanceof DenizBankClientError) return error;

    // Timeout: AbortController abort → DOMException "AbortError".
    if (
      typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return new DenizBankClientError(
        `DenizBank çağrısı zaman aşımına uğradı (${endpoint}, ${this.config.timeoutMs} ms).`,
        "TRANSIENT",
        { isTimeout: true },
      );
    }
    // Node ortamında abort bazen Error("The operation was aborted") düşer.
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message))
    ) {
      return new DenizBankClientError(
        `DenizBank çağrısı zaman aşımına uğradı (${endpoint}).`,
        "TRANSIENT",
        { isTimeout: true },
      );
    }
    // Ağ hatası: fetch reddi (DNS, bağlantı kopması vb.).
    if (error instanceof Error) {
      return new DenizBankClientError(
        `DenizBank'a ulaşılamadı (${endpoint}): ${error.message}`,
        "TRANSIENT",
        { isNetworkError: true },
      );
    }
    return new DenizBankClientError(
      `DenizBank çağrısında bilinmeyen hata (${endpoint}): ${String(error)}`,
      "UNKNOWN",
    );
  }

  /** Exponential backoff + jitter — transient hatalarda denemeler arası bekleme. */
  private backoff(attempt: number): Promise<void> {
    const exponential = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    return new Promise((resolve) => setTimeout(resolve, exponential + jitter));
  }

  /** İstek gövdesindeki AppKey'i maskeleyerek log'a güvenli hale getirir. */
  private maskRequestBody(requestBody: string): string {
    return requestBody.replace(
      this.config.appKey,
      maskAppKey(this.config.appKey),
    );
  }

  /**
   * ApiCallLog'a best-effort yazar — fire-and-forget kuyruk üzerinden.
   *
   * NEDEN KUYRUK: placeOrder, Order kaydı + provider gerçekleştirmesini tek
   * bir Prisma interactive transaction içinde koşar. Banka çağrısı bu tx
   * içinde gerçekleşirken log yazımının await edilmesi SQLite yazma kilidinde
   * karşılıklı bekleme (deadlock) yaratır: tx kilidi tutar → global client'ın
   * log yazımı kilidi bekler → tx banka çağrısının dönmesini bekler →
   * 5 saniyede tx timeout. Yazım kuyruğa atılır; denetim izi korunur
   * (tx rollback olsa bile bankaya giden çağrı loglanır).
   */
  private writeLog(entry: ApiCallLogEntry): void {
    const write = this.logApiCallFn(entry).catch((error: unknown) => {
      console.error(
        `[denizbank-base-client] ApiCallLog yazımı başarısız (${entry.endpoint}):`,
        error,
      );
    });
    this.pendingLogWrites.push(write);
  }

  /**
   * Kuyruktaki ApiCallLog yazımlarının tamamlanmasını bekler.
   * Testlerin deterministik doğrulaması (log sayımı/silmesi öncesi) ve
   * çağrı sonrası denetim için senkronizasyon noktasıdır.
   */
  async drainPendingLogs(): Promise<void> {
    const pending = this.pendingLogWrites;
    this.pendingLogWrites = [];
    await Promise.all(pending);
  }
}

// ============================================================
// FACTORY — env'den konfigürasyon
// ============================================================

/**
 * Ortam değişkenlerinden DenizBank istemcisi kurar.
 *
 * Mock mod karar ağacı:
 *  1. DENIZBANK_MOCK=true → her koşulda mock (test/geliştirme güvenliği).
 *  2. DENIZBANK_APP_KEY boş → otomatik mock (AppKey'siz canlı çağrı anlamsız
 *     ve tehlikelidir; platform sessizce gerçek istek atamaz).
 *  3. Aksi halde gerçek istemci (baseUrl + appKey zorunlu).
 */
export function createDenizBankClient(
  deps: DenizBankClientDeps = {},
): DenizBankBaseClient {
  const appKey = process.env.DENIZBANK_APP_KEY ?? "";
  const baseUrl = process.env.DENIZBANK_BASE_URL ?? "";
  const mockFlag = (process.env.DENIZBANK_MOCK ?? "").toLowerCase();
  const mock = mockFlag === "true" || mockFlag === "1" || appKey.trim() === "";

  return new DenizBankBaseClient(
    {
      baseUrl: baseUrl === "" ? "https://mock.denizbank.local" : baseUrl,
      appKey: appKey === "" ? "mock-app-key" : appKey,
      mock,
    },
    deps,
  );
}
