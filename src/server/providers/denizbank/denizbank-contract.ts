import { z } from "zod";
import type { DenizBankErrorClass } from "@/lib/types";

/**
 * DenizBank API Market sözleşme katmanı — tipler, Zod şemaları ve hata
 * sınıflandırma tablosu (docs/ARCHITECTURE.md Bölüm 2 + docs/DenizBank API
 * Market Download.txt).
 *
 * Sözleşme kuralları (dokümandan):
 *  - Tüm endpoint'ler POST + application/json.
 *  - Her istek: { Header: {...}, Parameters: [ ... ] } zarfı.
 *  - Header: AppKey (env), Channel="API", ChannelSessionId (taze GUID),
 *    ChannelRequestId (taze GUID) — "Her istekte farklı GUID değerler
 *    girilmeli" kuralı.
 *  - Yanıt: HTTP 200 + { Data: object } — HTTP 200 ≠ başarı; Data içeriği
 *    denetlenir. Hata durumunda Data içinde ErrorCode/ErrorDescription taşınır.
 *
 * Bu dosya saf sözleşme tanımıdır: ağ çağrısı, DB erişimi veya iş kuralı
 * içermez. BaseClient ve testler bu şemaları tek doğruluk kaynağı olarak
 * kullanır (ADR-9: dış sözleşmeler Zod ile doğrulanır).
 */

// ============================================================
// ZARF TİPLERİ
// ============================================================

/** İstek zarfı — dokümandaki yapıyla birebir. */
export interface DenizBankEnvelope<TParams> {
  Header: {
    AppKey: string;
    Channel: "API";
    /** Her istekte crypto.randomUUID() ile taze üretilir. */
    ChannelSessionId: string;
    /** Her istekte crypto.randomUUID() ile taze üretilir. */
    ChannelRequestId: string;
  };
  Parameters: TParams[];
}

/** Banka hata zarfı — Data içinde taşınır (HTTP 200 döner). */
export interface DenizBankErrorEnvelope {
  ErrorCode: string;
  ErrorDescription?: string;
}

/** Başarılı yanıt zarfı: { Data: <endpoint verisi> }. */
export interface DenizBankSuccessEnvelope<TData> {
  Data: TData;
}

/** Ham yanıt — Data hata zarfı VEYA endpoint verisidir. */
export type DenizBankRawResponse<TData = unknown> =
  | DenizBankSuccessEnvelope<TData>
  | DenizBankSuccessEnvelope<DenizBankErrorEnvelope>;

// ============================================================
// HATA SINIFLANDIRMA (Bölüm 2.3)
// ============================================================

/** Yeniden denenebilir hata kodları — exponential backoff ile retry. */
const TRANSIENT_ERROR_CODES = new Set(["201003"]);

/** Kalıcı hata kodları — retry YASAK (bakiye/limit/hesap/doğrulama). */
const PERMANENT_ERROR_CODES = new Set([
  "500201", // Bakiye yetersiz
  "90004", // İşlem limiti yetersiz
  "201001", // Hesap bulunamadı
  "201002", // Geçersiz IBAN
  "201005", // Başlangıç tarihi bitişten büyük (programatik hata)
  "30679", // Alıcı hesabı bulunamadı
  "60", // Hedef hesap geçersiz
  "1912201233", // Güvenlik nedeniyle işlem iptal
  "20502", // Muhasebe hatası
  "6066", // Yinelenen havale bağlamında geçersiz istek
]);

/** Ertelenir — emir PENDING kalır, koşul ortadan kalkınca yeniden denenir. */
const DEFERRED_ERROR_CODES = new Set(["90012", "90020"]);

/** 7895 zarfının geçici (retry edilebilir) alt tipleri. */
const TRANSIENT_ERR_SUBTYPES = ["errResponse", "errLoad"];

/**
 * Banka hata kodunu Bölüm 2.3 retry politikasına göre sınıflandırır.
 *
 * @param code        Banka hata kodu (örn. "500201").
 * @param description Banka hata açıklaması (7895 errType alt tipi için taranır).
 * @returns TRANSIENT (retry) | PERMANENT (retry yok) | DEFERRED (PENDING kal)
 *          | UNKNOWN (mutabakat gerekir).
 */
export function classifyBankError(
  code: string,
  description?: string,
): DenizBankErrorClass {
  if (TRANSIENT_ERROR_CODES.has(code)) return "TRANSIENT";
  if (PERMANENT_ERROR_CODES.has(code)) return "PERMANENT";
  if (DEFERRED_ERROR_CODES.has(code)) return "DEFERRED";
  // 7895: toplu ödeme zarfı — alt tip mesaj içinde taşınır.
  if (code === "7895") {
    const text = (description ?? "").toLowerCase();
    if (TRANSIENT_ERR_SUBTYPES.some((t) => text.includes(t))) {
      return "TRANSIENT";
    }
    return "PERMANENT";
  }
  return "UNKNOWN";
}

/** Bilinen banka hata kodlarının kullanıcıya dönük TR mesajları. */
const ERROR_MESSAGES_TR: Record<string, string> = {
  "500201": "Hesap bakiyeniz bu işlem için yetersiz.",
  "90004": "İşlem limitiniz yetersiz. Günlük döviz işlem limitinizi aştınız.",
  "201001": "Banka hesabı bulunamadı. Hesap yapılandırmanızı kontrol edin.",
  "201002": "Geçersiz IBAN numarası.",
  "201003": "Hesap bilgileri alınırken geçici bir hata oluştu.",
  "201004": "Tarih aralığı çok geniş; sorgu penceresi küçültülmeli.",
  "201005": "Başlangıç tarihi bitiş tarihinden büyük olamaz.",
  "90012": "Bu işlem şu anda kullanıma kapalı; işlem daha sonra tekrar denenecek.",
  "90020": "Bu işlem mesai saatleri dışında yapılamaz; mesai açılışında tekrar denenecek.",
  "1912201233": "İşlem güvenlik nedeniyle banka tarafından iptal edildi.",
  "20502": "Banka muhasebe hatası alındı; işlem mutabakatla doğrulanacak.",
  "30679": "Alıcı hesabı bulunamadı.",
  "60": "Hedef hesap geçersiz.",
  "6066": "Bu işlem bağlamında geçersiz istek.",
  "7895": "Toplu ödeme servisi hata döndürdü.",
};

/**
 * Banka hata kodu için kullanıcıya gösterilecek TR mesajı üretir.
 * Bilinen kod → hazır TR mesaj; bilinmeyen kod → banka açıklaması veya
 * genel mesaj (ham banka metaji asla doğrudan kullanıcıya gitmez).
 */
export function bankErrorMessage(
  code: string,
  bankDescription?: string,
): string {
  const known = ERROR_MESSAGES_TR[code];
  if (known) return known;
  if (bankDescription && bankDescription.trim() !== "") {
    return `Banka hatası (${code}): ${bankDescription}`;
  }
  return `Banka işlemi başarısız oldu (hata kodu: ${code}).`;
}

// ============================================================
// ZOD ŞEMALARI — İSTEK PARAMETRELERİ
// ============================================================

/** Parametresiz istekler (GetAccountList, GetCurrencyRateList) — boş nesne. */
export const emptyParamsSchema = z.object({}).strict();

/** POST /GetAccountDetail — tek hesap detayı. */
export const getAccountDetailParamsSchema = z
  .object({
    /** Banka hesap numarası. */
    AccountId: z.string().min(1),
  })
  .strict();

/** POST /ChangeExchange — döviz alım-satımı (çekirdek işlem). */
export const changeExchangeParamsSchema = z
  .object({
    /**
     * İşlem gören döviz cinsi (örn. "USD").
     * KRİTİK ASİMETRİ (dokümandan):
     *  - SATIŞ: Amount = satılacak döviz tutarı, ConvertedAmount = TL karşılığı.
     *  - ALIM:  Amount = TL tutarı, ConvertedAmount = alınacak döviz tutarı.
     */
    TransactionType: z.enum([
      "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD",
    ]),
    /** Anlamı yön'e göre değişir (yukarıdaki asimetri). */
    Amount: z.number().positive(),
    /** Anlamı yön'e göre değişir (yukarıdaki asimetri). */
    ConvertedAmount: z.number().positive(),
    /** İşlem yapılan banka hesabı. */
    AccountId: z.string().min(1),
  })
  .strict();

/** POST /GetTransactionDetail — TransactionID + SessionID mutabakatı. */
export const getTransactionDetailParamsSchema = z
  .object({
    TransactionID: z.string().min(1),
    SessionID: z.string().min(1),
  })
  .strict();

export type GetAccountDetailParams = z.infer<typeof getAccountDetailParamsSchema>;
export type ChangeExchangeParams = z.infer<typeof changeExchangeParamsSchema>;
export type GetTransactionDetailParams = z.infer<typeof getTransactionDetailParamsSchema>;

// ============================================================
// ZOD ŞEMALARI — YANITLAR
// ============================================================

/** Banka hesabı görünümü — GetAccountList/GetAccountDetail ortak öğe. */
const bankAccountSchema = z
  .object({
    AccountId: z.string(),
    IBAN: z.string(),
    CurrencyCode: z.string(),
    AvailableBalance: z.number(),
    TotalBalance: z.number(),
    AccountName: z.string().optional(),
  })
  .passthrough();

/** POST /GetAccountList yanıtı. */
export const getAccountListDataSchema = z
  .object({
    AccountList: z.array(bankAccountSchema).min(1),
  })
  .passthrough();

/** POST /GetAccountDetail yanıtı. */
export const getAccountDetailDataSchema = bankAccountSchema;

/** POST /ChangeExchange yanıtı. */
export const changeExchangeDataSchema = z
  .object({
    /** Banka işlem referansı — Order.transactionId alanına yazılır. */
    TransactionID: z.string().min(1),
    /** Kanal oturum referansı — Order.sessionId alanına yazılır. */
    SessionID: z.string().min(1),
    /** İşlem nihai durumu (örn. "Completed"). */
    Status: z.string().min(1),
    /** İşlem tutarı (yön asimetrisine tabi). */
    Amount: z.number().optional(),
    /** Karşı tutar (yön asimetrisine tabi). */
    ConvertedAmount: z.number().optional(),
    /** Uygulanan kur. */
    Rate: z.number().optional(),
  })
  .passthrough();

/** POST /GetCurrencyRateList yanıtı. */
export const getCurrencyRateListDataSchema = z
  .object({
    CurrencyRateList: z
      .array(
        z
          .object({
            /** Döviz cinsi (örn. "USD"). */
            CurrencyCode: z.string().min(1),
            /** Banka alış kuru (TL). */
            BuyRate: z.number().positive(),
            /** Banka satış kuru (TL). */
            SellRate: z.number().positive(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

/** POST /GetTransactionDetail yanıtı — mutabakatın tek doğruluk kaynağı. */
export const getTransactionDetailDataSchema = z
  .object({
    TransactionID: z.string().min(1),
    SessionID: z.string().min(1),
    /** İşlem nihai durumu: "Completed" | "Failed" | "Cancelled" | ... */
    Status: z.string().min(1),
    Amount: z.number().optional(),
    ConvertedAmount: z.number().optional(),
    ErrorCode: z.string().optional(),
    ErrorDescription: z.string().optional(),
  })
  .passthrough();

export type BankAccountData = z.infer<typeof bankAccountSchema>;
export type GetAccountListData = z.infer<typeof getAccountListDataSchema>;
export type GetAccountDetailData = z.infer<typeof getAccountDetailDataSchema>;
export type ChangeExchangeData = z.infer<typeof changeExchangeDataSchema>;
export type GetCurrencyRateListData = z.infer<typeof getCurrencyRateListDataSchema>;
export type GetTransactionDetailData = z.infer<typeof getTransactionDetailDataSchema>;

// ============================================================
// YARDIMCILAR
// ============================================================

/** crypto.randomUUID() çıktısı formatı — GUID doğrulama testlerinde kullanılır. */
export const GUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * AppKey'i log'a yazmadan önce maskeler (ADR-3: anahtar log'lara asla düz metin
 * gitmez). Yalnızca son 4 karakter görünür kalır.
 */
export function maskAppKey(appKey: string): string {
  if (appKey.length <= 4) return "****";
  return `****${appKey.slice(-4)}`;
}

/**
 * Ham yanıt gövdesinden hata zarfını çıkarır (varsa).
 * HTTP 200 ≠ başarı kuralı: Data içinde ErrorCode taşınıyorsa istek
 * başarısızdır. "0" veya boş ErrorCode başarı kabul edilir.
 */
export function extractErrorEnvelope(
  data: unknown,
): DenizBankErrorEnvelope | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const code = record["ErrorCode"];
  if (typeof code !== "string" || code === "" || code === "0") return null;
  const description = record["ErrorDescription"];
  return {
    ErrorCode: code,
    ErrorDescription: typeof description === "string" ? description : undefined,
  };
}
