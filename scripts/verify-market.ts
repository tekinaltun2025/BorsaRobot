/**
 * Faz 3 uçtan uca doğrulama scripti — Piyasa verisi + grafik + izleme listesi.
 *
 * Kullanım: npx tsx scripts/verify-market.ts
 *
 * Servis katmanını (price-service + market-simulator + watchlist-service)
 * doğrudan DB üzerinde çalıştırır ve şu akışları kanıtlar:
 *  1. Tick → izleme listesindeki hisselerin fiyatları değişir ve
 *     PriceHistory kayıtları eklenir.
 *  2. Deterministik tick: aynı seed aynı fiyat serisini üretir.
 *  3. History: farklı range'lerde (1D/1W/1M/3M/1Y) mumlar döner;
 *     OHLC formatı (time/open/high/low/close) doğrudur; mumlar
 *     zaman sıralıdır; high ≥ max(open, close), low ≤ min(open, close).
 *  4. Watchlist ekle/çıkar: yeni sembol eklenir, fiyat akışına dahil
 *     olur, çıkarılır (Stock kaydı korunur).
 *  5. Günlük değişim: dayOpen referansıyla change/changePercent tutarlı.
 *
 * Not: Script kendi test sembolünü oluşturur ve sonunda temizler;
 * mevcut izleme listesi verileri bozulmaz (eklenen sembol çıkarılır).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { runMarketTick, simulateNextPrice } from "../src/server/services/market-simulator";
import {
  getChartCandles,
  getStockStats,
  getWatchlistPrices,
  getStockDailySummary,
  appendPriceHistory,
  PriceServiceError,
} from "../src/server/services/price-service";
import {
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  listWatchlist,
} from "../src/server/services/watchlist-service";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Basit mulberry32 — deterministik PRNG (simülatörle aynı algoritma). */
function createTestRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  console.log("=== FAZ 3 — PİYASA VERİSİ DOĞRULAMA ===\n");

  const TEST_SYMBOL = "TSTX";
  const TEST_SEED = 12345;

  // --- Ortam temizliği: önceki koşu artıkları.
  const staleStock = await prisma.stock.findUnique({
    where: { symbol: TEST_SYMBOL },
  });
  if (staleStock) {
    await prisma.priceHistory.deleteMany({ where: { stockId: staleStock.id } });
    await prisma.watchlist.deleteMany({ where: { stockId: staleStock.id } });
    await prisma.stock.delete({ where: { id: staleStock.id } });
  }

  // ============================================================
  // 0) Ön koşul: seed izleme listesi dolu mu?
  // ============================================================
  const initialList = await listWatchlist();
  assert(
    initialList.length >= 5,
    `Seed izleme listesi beklenenden az (${initialList.length}); önce npm run db:seed çalıştırın.`,
  );
  check(
    "Seed izleme listesi mevcut",
    initialList.length >= 5,
    `${initialList.length} sembol: ${initialList.slice(0, 5).map((p) => p.symbol).join(", ")}...`,
  );

  // ============================================================
  // 1) Tick → fiyat değişimi + PriceHistory dolması.
  // ============================================================
  const before = await prisma.stock.findMany({
    where: { symbol: { in: initialList.map((p) => p.symbol) } },
    select: { symbol: true, lastPrice: true },
  });
  const beforeBySymbol = new Map(before.map((s) => [s.symbol, s.lastPrice?.toString() ?? null]));

  const historyCountBefore = await prisma.priceHistory.count();

  const tick1 = await runMarketTick();
  assert(tick1.processed > 0, "Tick hiçbir hisseyi işlemedi.");
  check(
    "Tick fiyat üretti",
    tick1.processed > 0,
    `${tick1.processed} hisse işlendi`,
  );

  const historyCountAfter = await prisma.priceHistory.count();
  assert(
    historyCountAfter >= historyCountBefore + tick1.processed,
    "PriceHistory kayıtları eklenmedi.",
  );
  check(
    "PriceHistory doluyor",
    historyCountAfter >= historyCountBefore + tick1.processed,
    `${historyCountBefore} → ${historyCountAfter} kayıt (+${historyCountAfter - historyCountBefore})`,
  );

  // Fiyatlar gerçekten değişti mi? (en az bir sembolde farklı olmalı;
  // rastgelelik aynı fiyata dönse bile tüm liste aynı kalamaz).
  const after = await prisma.stock.findMany({
    where: { symbol: { in: initialList.map((p) => p.symbol) } },
    select: { symbol: true, lastPrice: true },
  });
  const changedCount = after.filter((s) => {
    const prev = beforeBySymbol.get(s.symbol);
    return prev !== null && s.lastPrice?.toString() !== prev;
  }).length;
  assert(changedCount > 0, "Tick sonrası hiçbir fiyat değişmedi.");
  check(
    "Fiyatlar değişiyor",
    changedCount > 0,
    `${changedCount}/${after.length} sembolde fiyat değişti`,
  );

  // ============================================================
  // 2) Deterministik tick: aynı seed → aynı fiyat.
  // ============================================================
  const base = new Prisma.Decimal("100");
  const rngA = createTestRng(TEST_SEED);
  const rngB = createTestRng(TEST_SEED);
  const seriesA = Array.from({ length: 10 }, () => simulateNextPrice(base, rngA));
  const seriesB = Array.from({ length: 10 }, () => simulateNextPrice(base, rngB));
  const deterministic = seriesA.every((v, i) => {
    const other = seriesB[i];
    return other !== undefined && v.equals(other);
  });
  assert(deterministic, "Aynı seed farklı fiyat serisi üretti.");
  const firstPrice = seriesA[0] ?? base;
  const lastPrice = seriesA[seriesA.length - 1] ?? base;
  check(
    "Deterministik simülasyon (seed)",
    deterministic,
    `seed=${TEST_SEED}, 10 adımlı seri birebir aynı: ${firstPrice.toString()} → ${lastPrice.toString()}`,
  );

  // Volatilite sınırı: tek adım ±%2'den büyük hareket beklenmez (5σ).
  const maxMove = seriesA.reduce((max, v, i) => {
    if (i === 0) return max;
    const prev = Number(seriesA[i - 1]);
    return Math.max(max, Math.abs((Number(v) - prev) / prev));
  }, 0);
  assert(maxMove < 0.02, `Tek adımlı hareket ±%2'yi aştı: ${(maxMove * 100).toFixed(3)}%`);
  check(
    "Volatilite makul aralıkta",
    maxMove < 0.02,
    `maksimum tek adım hareketi: %${(maxMove * 100).toFixed(3)}`,
  );

  // ============================================================
  // 3) History: farklı range'lerde OHLC mumları.
  // ============================================================
  const sampleStock = initialList[0];
  if (sampleStock === undefined) {
    throw new Error(
      "Doğrulama başarısız: izleme listesi boş olduğu için örnek sembol seçilemedi.",
    );
  }
  const sampleSymbol = sampleStock.symbol;

  // 1D: bugünün tick'leri → en az 1 mum.
  const candles1D = await getChartCandles(sampleSymbol, "1D");
  assert(candles1D.length >= 1, "1D range mum döndürmedi.");
  check(
    "History 1D mumları",
    candles1D.length >= 1,
    `${candles1D.length} mum`,
  );

  // OHLC formatı + sıralama + high/low tutarlılığı (tüm mumlar üzerinde).
  const allValid = candles1D.every((c) => {
    const isSorted = true; // sıralama aşağıda ayrıca kontrol edilir
    const ohlcValid =
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) &&
      c.low <= c.high;
    return ohlcValid && isSorted;
  });
  const isTimeSorted = candles1D.every((c, i) => {
    const prev = candles1D[i - 1];
    return i === 0 || (prev !== undefined && prev.time < c.time);
  });
  assert(allValid, "OHLC formatı ihlali: high/low/open/close tutarsız.");
  assert(isTimeSorted, "Mumlar zaman sıralı değil.");
  check(
    "OHLC formatı doğrulandı",
    allValid && isTimeSorted,
    `${candles1D.length} mum, high ≥ max(O,C), low ≤ min(O,C), zaman sıralı`,
  );

  // Farklı range'ler: her biri anlamlı veri döndürmeli (1D ⊆ 1W ⊆ ...).
  const ranges = ["1W", "1M", "3M", "1Y"] as const;
  for (const range of ranges) {
    const candles = await getChartCandles(sampleSymbol, range);
    assert(candles.length >= 1, `${range} range mum döndürmedi.`);
    check(
      `History ${range} mumları`,
      candles.length >= 1,
      `${candles.length} mum`,
    );
  }

  // İstatistikler: en yüksek/en düşük/ortalama.
  const stats = await getStockStats(sampleSymbol, "1D");
  assert(stats.sampleCount > 0, "İstatistik örnekleme sayısı 0.");
  check(
    "Dönem istatistikleri",
    stats.sampleCount > 0,
    `yüksek=${stats.high}, düşük=${stats.low}, ort=${stats.average}, örneklem=${stats.sampleCount}`,
  );

  // ============================================================
  // 4) Watchlist ekle/çıkar.
  // ============================================================
  const added = await addToWatchlist({ symbol: TEST_SYMBOL, name: "Test Piyasa Hissesi" });
  assert(added.symbol === TEST_SYMBOL, "Ekleme sembolü uyuşmuyor.");
  const inList = await isInWatchlist(TEST_SYMBOL);
  assert(inList, "Eklenen sembol izleme listesinde bulunamadı.");
  check(
    "Watchlist ekleme",
    inList,
    `${TEST_SYMBOL} eklendi (watchlistId=${added.watchlistId.slice(0, 8)}...)`,
  );

  // Yeni sembol fiyatı yok → tick atlar; sonra manuel fiyat + history yaz,
  // sonraki tick'te akışa dahil olmalı.
  const tickWithNew = await runMarketTick({ symbols: [TEST_SYMBOL] });
  assert(
    tickWithNew.processed === 0,
    "Fiyatsız sembol tick'te işlenmemeli (lastPrice null).",
  );
  check(
    "Fiyatsız sembol tick'te atlanır",
    tickWithNew.processed === 0,
    "processed=0 (lastPrice null)",
  );

  // Manuel başlangıç fiyatı yaz → artık tick işlemeli.
  const testStock = await prisma.stock.findUniqueOrThrow({
    where: { symbol: TEST_SYMBOL },
  });
  await prisma.stock.update({
    where: { id: testStock.id },
    data: { lastPrice: new Prisma.Decimal("50") },
  });
  const tickWithPrice = await runMarketTick({ symbols: [TEST_SYMBOL] });
  assert(tickWithPrice.processed === 1, "Fiyatlı sembol tick'te işlenmedi.");
  check(
    "Yeni sembol fiyat akışına dahil",
    tickWithPrice.processed === 1,
    `${TEST_SYMBOL}: ${tickWithPrice.prices[TEST_SYMBOL]} TL`,
  );

  // Prices API görünümü: yeni sembol listede görünmeli.
  const pricesAfterAdd = await getWatchlistPrices();
  const addedInView = pricesAfterAdd.find((p) => p.symbol === TEST_SYMBOL);
  assert(addedInView !== undefined, "Eklenen sembol fiyat listesinde yok.");
  check(
    "Prices görünümünde yeni sembol",
    addedInView !== undefined,
    `lastPrice=${addedInView?.lastPrice}`,
  );

  // Çıkarma: Watchlist kaydı silinir, Stock kalır.
  await removeFromWatchlist(TEST_SYMBOL);
  const stillInList = await isInWatchlist(TEST_SYMBOL);
  assert(!stillInList, "Çıkarılan sembol hâlâ listede.");
  const stockAfterRemove = await prisma.stock.findUnique({
    where: { symbol: TEST_SYMBOL },
  });
  assert(stockAfterRemove !== null, "Stock kaydı silinmemeliydi.");
  check(
    "Watchlist çıkarma (Stock korunur)",
    !stillInList && stockAfterRemove !== null,
    `listede değil, Stock kaydı duruyor (id=${stockAfterRemove?.id.slice(0, 8)}...)`,
  );

  // Tekrar çıkarma idempotent: hata fırlatmamalı.
  await removeFromWatchlist(TEST_SYMBOL);
  check(
    "Çıkarma idempotent",
    true,
    "listede olmayan sembolun çıkarılması hata üretmedi",
  );

  // ============================================================
  // 5) Günlük değişim tutarlılığı (dayOpen referansı).
  // ============================================================
  const summary = await getStockDailySummary(sampleSymbol);
  if (summary.change !== null && summary.changePercent !== null) {
    // Servis sözleşmesi: change = lastPrice − dayOpen ⇒ dayOpen = lastPrice − change.
    // Not: Canlı Yahoo verisinde changePercent sağlayıcının kendi yuvarlamasıyla
    // gelir; 2 ondalık basamakta ±0.05 mutlak tolerans uygulanır (flaky önleme).
    const dayOpen = new Prisma.Decimal(summary.lastPrice ?? "0").sub(
      new Prisma.Decimal(summary.change),
    );
    const recomputedPct = new Prisma.Decimal(summary.change)
      .div(dayOpen)
      .mul(100);
    const pctDiff = recomputedPct
      .sub(new Prisma.Decimal(summary.changePercent))
      .abs();
    const matches = pctDiff.lessThanOrEqualTo(0.05);
    assert(matches, "changePercent, change/dayOpen ile tutarsız.");
    check(
      "Günlük değişim tutarlı",
      matches,
      `change=${summary.change}, %=${summary.changePercent}, sapma=${pctDiff.toDecimalPlaces(4)}`,
    );
  } else {
    check(
      "Günlük değişim tutarlı",
      true,
      "bugün için dayOpen yok — null alanlar beklendiği gibi",
    );
  }

  // ============================================================
  // 6) Hata sözleşmeleri.
  // ============================================================
  let notFoundThrown = false;
  try {
    await getChartCandles("NOPE1", "1D");
  } catch (error: unknown) {
    notFoundThrown = error instanceof PriceServiceError && error.code === "NOT_FOUND";
  }
  assert(notFoundThrown, "Var olmayan sembol NOT_FOUND fırlatmalı.");
  check(
    "Bilinmeyen sembol NOT_FOUND",
    notFoundThrown,
    "PriceServiceError(NOT_FOUND) fırlatıldı",
  );

  // --- Temizlik: test sembolünü tamamen kaldır.
  const cleanupStock = await prisma.stock.findUnique({
    where: { symbol: TEST_SYMBOL },
  });
  if (cleanupStock) {
    await prisma.priceHistory.deleteMany({ where: { stockId: cleanupStock.id } });
    await prisma.watchlist.deleteMany({ where: { stockId: cleanupStock.id } });
    await prisma.stock.delete({ where: { id: cleanupStock.id } });
  }
  console.log("\n🧹 Test sembolü temizlendi.");

  // --- Özet.
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== SONUÇ: ${passed}/${results.length} kontrol başarılı ===`);
  if (passed !== results.length) {
    process.exit(1);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("\n✗ DOĞRULAMA HATASI:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
