import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/app-error";
import type { Bist100SyncStatus } from "@/lib/types";

/**
 * BIST 100 bileşen servisi — endeks listesini internetten OTOMATİK çeker.
 *
 * Kaynak: İş Yatırım hisse tarayıcısı (SharePoint AJAX ucu).
 *   POST https://www.isyatirim.com.tr/tr-tr/analiz/_Layouts/15/IsYatirim.Website/StockInfo/CompanyInfoAjax.aspx/getScreenerDataNEW
 *   Gövde: { sektor:"", endeks:"01", takip:"", oneri:"", criterias:[["9","0","99999999","False"]], lang:"1055" }
 *   Yanıt: {"d":"[{\"Hisse\":\"AEFES - Anadolu Efes\",\"9\":\"2247.78\"}, …]"}
 *   — dış .d bir JSON string; Hisse = "SEMBOL - Şirket Adı", "9" = son fiyat.
 *   endeks=01 → BIST 100 (Ulusal-100); cookie/API key GEREKMEZ.
 *
 * Senkron sözleşmesi (kullanıcı verisi bütünlüğü):
 *  - Kaynaktan gelen her bileşen: Stock upsert (resmi ad zenginleştirilir) +
 *    Watchlist upsert (source="BIST100").
 *  - Endeksten ÇIKAN bileşenler: yalnızca source="BIST100" olan Watchlist
 *    kayıtları silinir. Kullanıcının elle eklediği (source="MANUAL") kayıtlara
 *    ASLA dokunulmaz; Stock kaydı ve emir/pozisyon geçmişi her koşulda korunur.
 *  - Her senkron SYNC_BIST100 JobRun kaydıyla izlenir (ADR-10).
 *  - Çakışma koruması: senkron çalışırken ikinci çağrı 409 reddedilir.
 *
 * Zamanlayıcı: startBist100Syncer() 5 dakikada bir senkron tetikler ve
 * process ömrü boyunca globalThis guard ile tek instance kalır (hot-reload güvenli).
 */

/** İş Yatırım hisse tarayıcı ucu — endeks=01 (BIST 100). */
const SCREENER_URL =
  "https://www.isyatirim.com.tr/tr-tr/analiz/_Layouts/15/IsYatirim.Website/StockInfo/CompanyInfoAjax.aspx/getScreenerDataNEW";

/** Tarayıcı sayfası Referer'ı — bazı CDN'ler referans kontrolü yapar. */
const SCREENER_REFERER =
  "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/gelismis-hisse-arama.aspx";

/** Sabit tarayıcı gövdesi: endeks 01 = BIST 100, kriter 9 = fiyat (0-99999999). */
const SCREENER_REQUEST_BODY = JSON.stringify({
  sektor: "",
  endeks: "01",
  takip: "",
  oneri: "",
  criterias: [["9", "0", "99999999", "False"]],
  lang: "1055",
});

/** Tek istek timeout'u (ms). */
const FETCH_TIMEOUT_MS = 15_000;
/** Ağ hatalarında toplam deneme sayısı. */
const FETCH_ATTEMPTS = 2;
/** Denemeler arası bekleme (ms). */
const RETRY_DELAY_MS = 1_000;

/** Kaynak sağlığı sınırları: bu aralığın dışı yanıt geçersiz sayılır. */
const MIN_CONSTITUENTS = 50;
const MAX_CONSTITUENTS = 200;

/** Otomatik senkron periyodu (ms) — 5 dakika. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** BIST 100 bileşeni — sembol, şirket adı ve kaynaktaki son fiyat (TL). */
export interface Bist100Constituent {
  symbol: string;
  name: string;
  price: number | null;
}

/** Kullanıcıya dönük senkron hatası — API katmanı httpStatus'a map eder. */
export class Bist100SyncError extends AppError {
  constructor(
    message: string,
    code:
      | "FETCH_ERROR"
      | "PARSE_ERROR"
      | "INVALID_RESPONSE"
      | "ALREADY_SYNCING",
    httpStatus: number = 502,
  ) {
    super(message, code, httpStatus);
  }
}

/** Senkron sonucu — manuel tetikleme yanıtı ve loglar için. */
export interface Bist100SyncResult {
  /** Kaynaktan çekilen bileşen sayısı. */
  fetchedCount: number;
  /** İzleme listesine YENİ eklenen bileşen sayısı. */
  addedCount: number;
  /** Endeksten çıktığı için izleme listesinden çıkarılan (BIST100 kaynaklı) kayıt sayısı. */
  removedCount: number;
  /** Senkron sonrası toplam izleme listesi kaydı. */
  totalWatchlist: number;
  /** Senkron anı (ISO). */
  syncedAt: string;
}

/** Syncer global durumu — hot-reload'a dayanıklı tek instance. */
interface Bist100GlobalState {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastFetchedCount: number | null;
  lastAddedCount: number | null;
  lastError: string | null;
  timer: ReturnType<typeof setInterval> | null;
}

const globalForBist100 = globalThis as unknown as {
  __bist100Syncer?: Bist100GlobalState;
};

function state(): Bist100GlobalState {
  if (!globalForBist100.__bist100Syncer) {
    globalForBist100.__bist100Syncer = {
      isSyncing: false,
      lastSyncedAt: null,
      lastFetchedCount: null,
      lastAddedCount: null,
      lastError: null,
      timer: null,
    };
  }
  return globalForBist100.__bist100Syncer;
}

/**
 * Türkçe/İngilizce sayı formatını ayrıştırır.
 *  - "2247.78"  → 2247.78 (kaynağın standart formatı)
 *  - "1.234,56" → 1234.56 (binlik ayracı + virgüllü ondalık — savunmacı)
 */
function parseTrNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Screener yanıt metnini bileşen listesine çevirir — katı doğrulamalı. */
function parseScreenerResponse(text: string): Bist100Constituent[] {
  let outer: unknown;
  try {
    outer = JSON.parse(text);
  } catch {
    throw new Bist100SyncError(
      "İş Yatırım kaynağı JSON yanıt döndürmedi.",
      "PARSE_ERROR",
    );
  }

  const innerRaw =
    typeof (outer as { d?: unknown } | null)?.d === "string"
      ? ((outer as { d: string }).d)
      : null;
  if (!innerRaw) {
    throw new Bist100SyncError(
      "Kaynak yanıtında bileşen verisi (d alanı) bulunamadı.",
      "PARSE_ERROR",
    );
  }

  let items: unknown;
  try {
    items = JSON.parse(innerRaw);
  } catch {
    throw new Bist100SyncError(
      "BIST 100 bileşen listesi çözümlenemedi.",
      "PARSE_ERROR",
    );
  }
  if (!Array.isArray(items)) {
    throw new Bist100SyncError(
      "BIST 100 bileşen listesi dizi formatında değil.",
      "PARSE_ERROR",
    );
  }

  const constituents: Bist100Constituent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const hisse = typeof record["Hisse"] === "string" ? record["Hisse"] : null;
    if (!hisse) continue;

    // "SEMBOL - Şirket Adı" → sembol + ad ayrımı.
    const sepIndex = hisse.indexOf(" - ");
    const symbol = (
      sepIndex === -1 ? hisse : hisse.slice(0, sepIndex)
    )
      .trim()
      .toUpperCase();
    const name =
      (sepIndex === -1 ? symbol : hisse.slice(sepIndex + 3)).trim() || symbol;

    // Sembol sanitizasyonu: yalnızca harf/rakam (2-10 karakter) kabul edilir.
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    const priceRaw = record["9"];
    const price =
      typeof priceRaw === "string"
        ? parseTrNumber(priceRaw)
        : typeof priceRaw === "number" && Number.isFinite(priceRaw)
          ? priceRaw
          : null;

    constituents.push({ symbol, name, price });
  }

  if (
    constituents.length < MIN_CONSTITUENTS ||
    constituents.length > MAX_CONSTITUENTS
  ) {
    throw new Bist100SyncError(
      `BIST 100 listesi tutarsız: ${constituents.length} bileşen geldi ` +
        `(beklenen aralık ${MIN_CONSTITUENTS}-${MAX_CONSTITUENTS}). Kaynak değişmiş olabilir.`,
      "INVALID_RESPONSE",
    );
  }
  return constituents;
}

/**
 * BIST 100 bileşen listesini İş Yatırım kaynağından çeker.
 * Ağ hatalarında 1 kez yeniden dener; katı format doğrulaması uygular.
 */
export async function fetchBist100Constituents(): Promise<
  Bist100Constituent[]
> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(SCREENER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "X-RequestDigest": "noDigest",
          "X-Requested-With": "XMLHttpRequest",
          Referer: SCREENER_REFERER,
          Origin: "https://www.isyatirim.com.tr",
        },
        body: SCREENER_REQUEST_BODY,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Bist100SyncError(
          `İş Yatırım kaynağı HTTP ${response.status} döndü.`,
          "FETCH_ERROR",
          response.status === 429 ? 429 : 502,
        );
      }

      const text = await response.text();
      return parseScreenerResponse(text);
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Bist100SyncError
    ? lastError
    : new Bist100SyncError(
        `BIST 100 listesi alınamadı: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
        "FETCH_ERROR",
      );
}

/**
 * Çekilen BIST 100 bileşenlerini izleme listesiyle senkronize eder.
 *
 * Ekleme: tüm bileşenler Stock + Watchlist'e upsert edilir (source="BIST100").
 * Çıkarma: yalnızca source="BIST100" olup endeksten çıkan kayıtlar silinir.
 * MANUAL kayıtlar ve Stock/emir/pozisyon geçmişi her koşulda korunur.
 */
export async function syncBist100ToWatchlist(): Promise<Bist100SyncResult> {
  const s = state();
  if (s.isSyncing) {
    throw new Bist100SyncError(
      "BIST 100 senkronu zaten çalışıyor — lütfen bitmesini bekleyin.",
      "ALREADY_SYNCING",
      409,
    );
  }
  s.isSyncing = true;
  s.lastError = null;

  const job = await prisma.jobRun.create({
    data: { jobType: "SYNC_BIST100", status: "RUNNING" },
  });

  try {
    const constituents = await fetchBist100Constituents();
    const symbols = constituents.map((c) => c.symbol);

    let addedCount = 0;
    for (const constituent of constituents) {
      const stock = await prisma.stock.upsert({
        where: { symbol: constituent.symbol },
        update: {
          // Resmi şirket adı kaynaktan tazelenir; lastPrice'a dokunulmaz
          // (canlı fiyat akışının sahibi price-service/Yahoo'dur).
          name: constituent.name,
          isActive: true,
        },
        create: {
          symbol: constituent.symbol,
          name: constituent.name,
          isActive: true,
          // Yeni hissede kaynaktaki fiyat başlangıç değeri olarak yazılır;
          // fiyatı null olan mevcut kayıtlar Yahoo akışına bırakılır.
          ...(constituent.price !== null
            ? { lastPrice: constituent.price.toString() }
            : {}),
        },
      });

      const existing = await prisma.watchlist.findUnique({
        where: { stockId: stock.id },
        select: { id: true },
      });
      if (!existing) addedCount += 1;

      await prisma.watchlist.upsert({
        where: { stockId: stock.id },
        // Mevcut kaydın source'una dokunulmaz: kullanıcı bu hisseyi elle
        // eklediyse (MANUAL) kendi verisi olarak kalır ve endeksten çıkınca
        // bile senkron tarafından asla silinmez. source="BIST100" yalnızca
        // senkronun kendisinin açtığı yeni kayıtlara yazılır.
        update: {},
        create: {
          stockId: stock.id,
          source: "BIST100",
          autoAnalyze: true,
        },
      });
    }

    // Endeksten çıkan BIST100 kaynaklı kayıtları temizle (MANUAL'a dokunma).
    const staleEntries = await prisma.watchlist.findMany({
      where: { source: "BIST100", stock: { symbol: { notIn: symbols } } },
      select: { id: true },
    });
    let removedCount = 0;
    if (staleEntries.length > 0) {
      const deletion = await prisma.watchlist.deleteMany({
        where: { id: { in: staleEntries.map((entry) => entry.id) } },
      });
      removedCount = deletion.count;
    }

    const totalWatchlist = await prisma.watchlist.count();
    const syncedAt = new Date().toISOString();

    const result: Bist100SyncResult = {
      fetchedCount: constituents.length,
      addedCount,
      removedCount,
      totalWatchlist,
      syncedAt,
    };

    s.lastSyncedAt = syncedAt;
    s.lastFetchedCount = constituents.length;
    s.lastAddedCount = addedCount;
    s.lastError = null;

    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        processedCount: constituents.length,
        resultSummary: JSON.stringify({
          addedCount,
          removedCount,
          totalWatchlist,
        }),
      },
    });

    return result;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    s.lastError = message;

    await prisma.jobRun
      .update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: message.slice(0, 500),
        },
      })
      .catch(() => undefined);

    throw error instanceof Bist100SyncError
      ? error
      : new Bist100SyncError(
          `BIST 100 senkronu başarısız: ${message}`,
          "FETCH_ERROR",
        );
  } finally {
    s.isSyncing = false;
  }
}

/**
 * Senkron durumunu döndürür — UI rozeti ve API GET yanıtı.
 * Process yeni başladıysa (global state boşsa) kalıcı JobRun kaydından
 * son başarılı senkron okunur.
 */
export async function getBist100SyncStatus(): Promise<Bist100SyncStatus> {
  const s = state();

  let lastSyncedAt = s.lastSyncedAt;
  let lastFetchedCount = s.lastFetchedCount;
  let lastAddedCount = s.lastAddedCount;

  if (lastSyncedAt === null) {
    const lastSuccess = await prisma.jobRun.findFirst({
      where: { jobType: "SYNC_BIST100", status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, processedCount: true, resultSummary: true },
    });
    if (lastSuccess) {
      lastSyncedAt = lastSuccess.startedAt.toISOString();
      lastFetchedCount = lastSuccess.processedCount;
      try {
        const parsed = JSON.parse(
          lastSuccess.resultSummary ?? "{}",
        ) as { addedCount?: unknown };
        lastAddedCount =
          typeof parsed.addedCount === "number" ? parsed.addedCount : null;
      } catch {
        lastAddedCount = null;
      }
    }
  }

  return {
    isSyncing: s.isSyncing,
    lastSyncedAt,
    lastFetchedCount,
    lastAddedCount,
    lastError: s.lastError,
  };
}

/** Zamanlanmış senkron çalıştırıcısı — hata loglanır, asla fırlatılmaz. */
async function runScheduledSync(): Promise<void> {
  try {
    const result = await syncBist100ToWatchlist();
    console.log(
      `[bist100 syncer] Senkron başarılı: ${result.fetchedCount} bileşen, ` +
        `+${result.addedCount} yeni, -${result.removedCount} çıkarılan ` +
        `(izleme listesi: ${result.totalWatchlist}).`,
    );
  } catch (error: unknown) {
    console.error(
      "[bist100 syncer] Senkron hatası:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * BIST 100 otomatik senkron zamanlayıcısını başlatır — instrumentation.ts
 * register() içinden çağrılır. İlk senkron hemen (fire-and-forget) yapılır;
 * sonrasında SYNC_INTERVAL_MS periyoduyla tekrarlanır.
 *
 * Idempotent: globalThis guard sayesinde hot-reload'da ikinci instance açılmaz.
 */
export function startBist100Syncer(): void {
  const s = state();
  if (s.timer !== null) {
    console.log("[bist100 syncer] Zaten çalışıyor — yeni instance açılmadı.");
    return;
  }
  s.timer = setInterval(() => {
    void runScheduledSync();
  }, SYNC_INTERVAL_MS);
  console.log(
    `[bist100 syncer] Başlatıldı (aralık ${SYNC_INTERVAL_MS / 1000}sn; ` +
      "İş Yatırım kaynağı, endeks=01).",
  );
  // Açılışta liste hemen güncel olsun — hata loglanır, süreci kırmaz.
  void runScheduledSync();
}

/** Senkron zamanlayıcısını durdurur — test/teardown amaçlı. */
export function stopBist100Syncer(): void {
  const s = state();
  if (s.timer !== null) {
    clearInterval(s.timer);
    s.timer = null;
    console.log("[bist100 syncer] Durduruldu.");
  }
}

/** Senkron zamanlayıcısı bu process'te çalışıyor mu? */
export function isBist100SyncerRunning(): boolean {
  return state().timer !== null;
}
