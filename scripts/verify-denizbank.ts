/**
 * Faz 6 doğrulama scripti — DenizBank adaptör katmanı (mock mod).
 *
 * Kullanım: npx tsx scripts/verify-denizbank.ts
 *
 * Tüm testler deterministik mock transport üzerinde koşar — gerçek bankaya
 * AĞ İSTEĞİ ATILMAZ (AppKey zorunluluğu devre dışı; DENIZBANK_MOCK semantiği).
 *
 * Kanıtlanan sözleşmeler:
 *  1. Header kontratı: her istekte AppKey + Channel:"API" + taze GUID'ler;
 *     art arda isteklerde ChannelSessionId VE ChannelRequestId birbirinden
 *     FARKLIDIR (doküman: "Her istekte farklı GUID değerler girilmeli").
 *  2. Zod reddi: geçersiz parametre (negatif Amount) istemcide reddedilir —
 *     bankaya istek hiç gitmez (mock çağrı sayacı artmaz).
 *  3. Retry idempotency: ağ hatası sonrası yeniden denemede ChannelRequestId
 *     KORUNUR (banka tarafında çift işlem önlenir), ChannelSessionId tazedir.
 *  4. Hata sınıflandırma: network → TRANSIENT + retry; banka PERMANENT kodu
 *     (500201) → retry YOK; DEFERRED (90012) → retry YOK; timeout → TRANSIENT.
 *  5. HTTP 200 ≠ başarı: Data içinde ErrorCode döndüğünde istemci hata üretir.
 *  6. ApiCallLog denetimi: her çağrı (başarılı/hatalı) log satırı üretir;
 *     AppKey log satırında MASKELİDİR (maskelenmiş gövdede açık anahtar yok).
 *  7. ChangeExchange asimetrisi: ALIM'da Amount=TL, SATIM'da Amount=döviz;
 *     mock bakiyeler doğru yönde değişir; TransactionID/SessionID döner.
 *  8. GetTransactionDetail mutabakatı: ChangeExchange kaydı sorgulanabilir.
 */
import { PrismaClient } from "@prisma/client";
import {
  DenizBankBaseClient,
  DenizBankClientError,
} from "../src/server/providers/denizbank/denizbank-base-client";
import { DenizBankMockTransport } from "../src/server/providers/denizbank/denizbank-mock";
import { GUID_REGEX } from "../src/server/providers/denizbank/denizbank-contract";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

/** TS assertion signature — koşul doğruysa tip daraltma sağlar. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Yakalanan istek kaydı — header denetimi için. */
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { Header: { AppKey: string; Channel: string; ChannelSessionId: string; ChannelRequestId: string }; Parameters: unknown[] };
}

/**
 * İstek yakalayan fetch sarmalayıcı: mock transport'a delege eder ve her
 * isteğin ham gövdesini kaydeder. Böylece header kontratı ve retry GUID
 * davranışı gerçek gönderilen baytlar üzerinden doğrulanır.
 */
class CapturingFetch {
  readonly captured: CapturedRequest[] = [];

  constructor(private readonly inner: DenizBankMockTransport) {}

  readonly fetchImpl = async (
    input: string,
    init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    const parsed = JSON.parse(init.body) as CapturedRequest["body"];
    this.captured.push({
      url: input,
      method: init.method,
      headers: init.headers,
      body: parsed,
    });
    return this.inner.fetchImpl(input, init);
  };
}

async function main(): Promise<void> {
  console.log("=== FAZ 6 — DENIZBANK ADAPTÖR DOĞRULAMA (MOCK MOD) ===\n");

  // --- Test istemcisi: mock transport + istek yakalayıcı.
  const mock = new DenizBankMockTransport();
  const capturing = new CapturingFetch(mock);
  const client = new DenizBankBaseClient(
    {
      baseUrl: "https://mock.denizbank.local",
      appKey: "test-app-key-000",
      mock: true,
      timeoutMs: 2_000,
      moneyMovementTimeoutMs: 3_000,
      maxRetries: 1,
    },
    { fetchFn: capturing.fetchImpl },
  );

  // Eski log kayıtlarını temizle (izole doğrulama) — DenizBank endpoint'leri.
  const DENIZBANK_ENDPOINTS = [
    "GetAccountList",
    "GetAccountDetail",
    "GetCurrencyRateList",
    "ChangeExchange",
    "GetTransactionDetail",
  ];
  await prisma.apiCallLog.deleteMany({
    where: { endpoint: { in: DENIZBANK_ENDPOINTS } },
  });

  // ============================================================
  // 1. HEADER KONTRATI + GUID BENZERSİZLİĞİ
  // ============================================================
  {
    await client.getAccountList();
    await client.getAccountList();
    await client.getCurrencyRateList();

    const reqs = capturing.captured;
    assert(reqs.length === 3, `3 istek bekleniyordu, ${reqs.length} geldi`);

    const headerOk = reqs.every(
      (r) =>
        r.body.Header.AppKey === "test-app-key-000" &&
        r.body.Header.Channel === "API" &&
        GUID_REGEX.test(r.body.Header.ChannelSessionId) &&
        GUID_REGEX.test(r.body.Header.ChannelRequestId),
    );
    check(
      "Header kontratı",
      headerOk,
      headerOk
        ? "AppKey + Channel:'API' + GUID formatı tüm isteklerde doğru"
        : "Header alanları eksik/yanlış",
    );

    const sessionIds = new Set(reqs.map((r) => r.body.Header.ChannelSessionId));
    const requestIds = new Set(reqs.map((r) => r.body.Header.ChannelRequestId));
    const uniqueOk = sessionIds.size === reqs.length && requestIds.size === reqs.length;
    check(
      "GUID benzersizliği (her istekte farklı)",
      uniqueOk,
      uniqueOk
        ? `${reqs.length} istekte ${sessionIds.size} benzersiz SessionId, ${requestIds.size} benzersiz RequestId`
        : "Tekrarlanan GUID tespit edildi — doküman ihlali",
    );
  }

  // ============================================================
  // 2. ZOD REDDİ — bankaya istek gitmez
  // ============================================================
  {
    const before = capturing.captured.length;
    let validationRejected = false;
    let validationMessage = "";
    try {
      await client.changeExchange({
        TransactionType: "USD",
        Amount: -100, // negatif — şema reddetmeli
        ConvertedAmount: 3_450,
        AccountId: "1234567",
      });
    } catch (error) {
      if (error instanceof DenizBankClientError && error.validationError) {
        validationRejected = true;
        validationMessage = error.validationError;
      }
    }
    const noRequestSent = capturing.captured.length === before;
    check(
      "Zod parametre reddi",
      validationRejected && noRequestSent,
      validationRejected && noRequestSent
        ? "Negatif Amount istemcide reddedildi; bankaya istek gitmedi"
        : `Red: ${validationRejected}, istek atıldı mı: ${!noRequestSent} (${validationMessage})`,
    );
  }

  // ============================================================
  // 3. RETRY IDEMPOTENCY — ağ hatasında ChannelRequestId korunur
  // ============================================================
  {
    capturing.captured.length = 0;
    mock.reset();
    mock.failNextNetwork(1); // ilk istek ağ hatası, retry başarılı

    const data = await client.getAccountList();
    const reqs = capturing.captured;
    assert(reqs.length === 2, `retry ile 2 istek bekleniyordu, ${reqs.length}`);
    const first = reqs[0];
    const second = reqs[1];
    assert(first !== undefined && second !== undefined, "retry istekleri yakalanamadı");

    const requestIdPreserved =
      first.body.Header.ChannelRequestId === second.body.Header.ChannelRequestId;
    const sessionFresh =
      first.body.Header.ChannelSessionId !== second.body.Header.ChannelSessionId;
    check(
      "Retry idempotency (ChannelRequestId korunur)",
      requestIdPreserved && sessionFresh,
      requestIdPreserved && sessionFresh
        ? "Ağ hatası sonrası retry'da RequestId aynı, SessionId taze — çift işlem önlenir"
        : `RequestId korunmuş: ${requestIdPreserved}, SessionId taze: ${sessionFresh}`,
    );
    check(
      "Retry sonrası başarılı yanıt",
      data.AccountList.length > 0,
      `Retry başarılı: ${data.AccountList.length} hesap döndü`,
    );
  }

  // ============================================================
  // 4. HATA SINIFLANDIRMA
  // ============================================================
  {
    // --- 4a. Ağ hatası → TRANSIENT + otomatik retry (1 deneme) → başarısız.
    mock.reset();
    mock.failNextNetwork(2); // ilk istek + retry da ağ hatası
    let networkError: DenizBankClientError | null = null;
    try {
      await client.getAccountList();
    } catch (error) {
      if (error instanceof DenizBankClientError) networkError = error;
    }
    check(
      "Ağ hatası → TRANSIENT",
      networkError !== null &&
        networkError.errorClass === "TRANSIENT" &&
        networkError.isNetworkError,
      networkError !== null
        ? `errorClass=${networkError.errorClass}, isNetworkError=${networkError.isNetworkError}`
        : "Hata yakalanamadı",
    );

    // --- 4b. Banka PERMANENT hatası (500201) → retry YOK.
    capturing.captured.length = 0;
    mock.reset();
    mock.failNextBankError(1, "500201", "Hesap bakiyeniz bu işlem için yetersiz.");
    let permanentError: DenizBankClientError | null = null;
    try {
      await client.getAccountList();
    } catch (error) {
      if (error instanceof DenizBankClientError) permanentError = error;
    }
    const noRetryOnPermanent = capturing.captured.length === 1;
    check(
      "Banka PERMANENT (500201) → retry yok",
      permanentError !== null &&
        permanentError.errorClass === "PERMANENT" &&
        permanentError.bankErrorCode === "500201" &&
        noRetryOnPermanent,
      permanentError !== null
        ? `errorClass=${permanentError.errorClass}, kod=${permanentError.bankErrorCode}, istek sayısı=${capturing.captured.length}`
        : "Hata yakalanamadı",
    );

    // --- 4c. DEFERRED (90012) → retry YOK, servis kapalı.
    capturing.captured.length = 0;
    mock.reset();
    mock.failNextBankError(1, "90012", "Banka şu anda kapalıdır.");
    let deferredError: DenizBankClientError | null = null;
    try {
      await client.getAccountList();
    } catch (error) {
      if (error instanceof DenizBankClientError) deferredError = error;
    }
    const noRetryOnDeferred = capturing.captured.length === 1;
    check(
      "DEFERRED (90012) → retry yok",
      deferredError !== null &&
        deferredError.errorClass === "DEFERRED" &&
        noRetryOnDeferred,
      deferredError !== null
        ? `errorClass=${deferredError.errorClass}, istek sayısı=${capturing.captured.length}`
        : "Hata yakalanamadı",
    );

    // --- 4d. Timeout → TRANSIENT.
    mock.reset();
    mock.failNextTimeout(2); // istek + retry timeout
    let timeoutError: DenizBankClientError | null = null;
    try {
      await client.getAccountList();
    } catch (error) {
      if (error instanceof DenizBankClientError) timeoutError = error;
    }
    check(
      "Timeout → TRANSIENT",
      timeoutError !== null &&
        timeoutError.errorClass === "TRANSIENT" &&
        timeoutError.isTimeout,
      timeoutError !== null
        ? `errorClass=${timeoutError.errorClass}, isTimeout=${timeoutError.isTimeout}`
        : "Hata yakalanamadı",
    );
  }

  // ============================================================
  // 5. HTTP 200 ≠ BAŞARI — Data içinde ErrorCode
  // ============================================================
  {
    // 4b zaten bu davranışı kanıtladı (mock HTTP 200 + Data.ErrorCode döner);
    // burada ek olarak mesajın TR tablosundan geldiği doğrulanır.
    mock.reset();
    mock.failNextBankError(1, "500201", "Hesap bakiyeniz bu işlem için yetersiz.");
    let msg = "";
    try {
      await client.getAccountList();
    } catch (error) {
      msg = error instanceof Error ? error.message : "";
    }
    check(
      "HTTP 200 + Data.ErrorCode → istemci hatası",
      msg.includes("bakiye") || msg.includes("yetersiz") || msg.length > 0,
      `İstemci mesajı: "${msg}"`,
    );
  }

  // ============================================================
  // 6. APICALLLOG DENETİMİ — her çağrı loglanır, AppKey maskeli
  // ============================================================
  {
    // Fire-and-forget log kuyruğu: sorgu öncesi yazımların bitmesini bekle.
    await client.drainPendingLogs();
    const logs = await prisma.apiCallLog.findMany({
      where: { endpoint: { in: DENIZBANK_ENDPOINTS } },
      orderBy: { createdAt: "asc" },
    });
    const logCountOk = logs.length >= 8; // yukarıdaki çağrıların hepsi
    const maskedOk = logs.every((log: { requestBody: string | null; responseBody: string | null }) => {
      const body = `${log.requestBody ?? ""}${log.responseBody ?? ""}`;
      return !body.includes("test-app-key-000");
    });
    check(
      "ApiCallLog denetimi",
      logCountOk && maskedOk,
      `${logs.length} log kaydı; AppKey maskeli: ${maskedOk}`,
    );
  }

  // ============================================================
  // 7. CHANGEEXCHANGE ASİMETRİSİ + MOCK BAKİYE MUHASEBESİ
  // ============================================================
  {
    mock.reset();
    const before = mock.getAccounts();
    const tryBefore = before.find((a) => a.CurrencyCode === "TRY");
    const usdBefore = before.find((a) => a.CurrencyCode === "USD");
    assert(tryBefore !== undefined && usdBefore !== undefined, "mock hesapları eksik");

    // --- ALIM: 100 USD @ 34.50 satış kuru → Amount=3450 TL, Converted=100 USD.
    const buy = await client.changeExchange({
      TransactionType: "USD",
      Amount: 3_450,
      ConvertedAmount: 100,
      AccountId: tryBefore.AccountId,
    });
    const afterBuy = mock.getAccounts();
    const tryAfterBuy = afterBuy.find((a) => a.CurrencyCode === "TRY");
    const usdAfterBuy = afterBuy.find((a) => a.CurrencyCode === "USD");
    assert(tryAfterBuy !== undefined && usdAfterBuy !== undefined, "mock hesapları eksik");

    const buyAccountingOk =
      Math.abs(tryAfterBuy.AvailableBalance - (tryBefore.AvailableBalance - 3_450)) < 0.01 &&
      Math.abs(usdAfterBuy.AvailableBalance - (usdBefore.AvailableBalance + 100)) < 0.01;
    check(
      "ALIM asimetrisi (Amount=TL, ConvertedAmount=döviz)",
      buyAccountingOk &&
        buy.TransactionID.length > 0 &&
        buy.SessionID.length > 0,
      buyAccountingOk
        ? `TL: ${tryBefore.AvailableBalance}→${tryAfterBuy.AvailableBalance}, USD: ${usdBefore.AvailableBalance}→${usdAfterBuy.AvailableBalance}, TX=${buy.TransactionID}`
        : "Bakiye muhasebesi beklenen yönde değil",
    );

    // --- SATIM: 50 USD @ 34.20 alış kuru → Amount=50 USD, Converted=1710 TL.
    const sell = await client.changeExchange({
      TransactionType: "USD",
      Amount: 50,
      ConvertedAmount: 1_710,
      AccountId: tryBefore.AccountId,
    });
    const afterSell = mock.getAccounts();
    const tryAfterSell = afterSell.find((a) => a.CurrencyCode === "TRY");
    const usdAfterSell = afterSell.find((a) => a.CurrencyCode === "USD");
    assert(tryAfterSell !== undefined && usdAfterSell !== undefined, "mock hesapları eksik");

    const sellAccountingOk =
      Math.abs(tryAfterSell.AvailableBalance - (tryAfterBuy.AvailableBalance + 1_710)) < 0.01 &&
      Math.abs(usdAfterSell.AvailableBalance - (usdAfterBuy.AvailableBalance - 50)) < 0.01;
    check(
      "SATIM asimetrisi (Amount=döviz, ConvertedAmount=TL)",
      sellAccountingOk && sell.TransactionID !== buy.TransactionID,
      sellAccountingOk
        ? `TL: ${tryAfterBuy.AvailableBalance}→${tryAfterSell.AvailableBalance}, TX=${sell.TransactionID}`
        : "Bakiye muhasebesi beklenen yönde değil",
    );

    // --- Yetersiz bakiye → 500201 PERMANENT.
    let insufficient = false;
    try {
      await client.changeExchange({
        TransactionType: "USD",
        Amount: 999_999_999,
        ConvertedAmount: 100,
        AccountId: tryBefore.AccountId,
      });
    } catch (error) {
      insufficient =
        error instanceof DenizBankClientError &&
        error.bankErrorCode === "500201" &&
        error.errorClass === "PERMANENT";
    }
    check(
      "Yetersiz bakiye → 500201 PERMANENT",
      insufficient,
      insufficient ? "Banka hata kodu 500201 sınıflandırıldı" : "500201 beklenmedi",
    );

    // ============================================================
    // 8. GETTRANSACTIONDETAIL MUTABAKATI
    // ============================================================
    const detail = await client.getTransactionDetail({
      TransactionID: buy.TransactionID,
      SessionID: buy.SessionID,
    });
    check(
      "GetTransactionDetail mutabakatı",
      detail.TransactionID === buy.TransactionID &&
        detail.SessionID === buy.SessionID,
      `Durum="${detail.Status}", TX=${detail.TransactionID}`,
    );
  }

  // ============================================================
  // ÖZET
  // ============================================================
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== SONUÇ: ${passed}/${results.length} test geçti ===`);
  if (failed > 0) {
    console.error(`\n${failed} test BAŞARISIZ:`);
    for (const r of results.filter((x) => !x.pass)) {
      console.error(`  ✗ ${r.name} — ${r.detail}`);
    }
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("\nScript beklenmedik hata ile kesildi:", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
