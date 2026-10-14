/**
 * BIST 100 otomatik senkron doğrulama scripti.
 *
 * Kullanım: npx tsx scripts/verify-bist100.ts  (veya npm run verify:bist100)
 *
 * Gerçek İş Yatırım kaynağına bağlanır (cookie/key gerekmez):
 *  1. fetchBist100Constituents — güncel BIST 100 listesi çekilir; adet ve
 *     bilinen kalıcı semboller (THYAO, ASELS, GARAN vb.) kontrol edilir.
 *  2. syncBist100ToWatchlist — izleme listesi senkronize edilir; toplam
 *     kayıt >= bileşen sayısı olmalı.
 *  3. MANUAL koruma — kullanıcı elle eklediği kayıtlar senkron sonrası da
 *     durmalı (senkron yalnızca BIST100 kaynaklı kayıtları yönetir).
 *  4. Stale temizleme — endekste olmayan BIST100 kaynaklı kayıt senkronda
 *     listeden düşmeli (test kaydı sonunda tamamen temizlenir).
 *  5. İkinci senkron — idempotent: yeni ekleme olmamalı.
 *  6. getBist100SyncStatus — durum alanları dolu dönmeli.
 *
 * Ağ erişimi yoksa: kaynak testleri "atlandı" olarak işaretlenir ve script
 * hata vermeden biter (CI dostu — verify-ai-providers deseni).
 */
import { PrismaClient } from "@prisma/client";
import {
  Bist100SyncError,
  fetchBist100Constituents,
  getBist100SyncStatus,
  syncBist100ToWatchlist,
} from "../src/server/services/bist100-service";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-ai-providers.ts deseni. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Hatayı kısa tanımla (log okunabilirliği). */
function errBrief(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ağ erişim hatası mı? (offline ortamlarda graceful atlama için). */
function isNetworkError(message: string): boolean {
  return /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|aborted|TIMEOUT|UND_ERR|ECONNRESET/i.test(
    message,
  );
}

/** Stale temizleme testi için endekste olmayacak güvenli test sembolü. */
const STALE_TEST_SYMBOL = "ZZZTST";

/** BIST 100'ün kalıcı çekirdek üyeleri — kaynak sağlığı göstergesi. */
const KNOWN_CORE_SYMBOLS = ["THYAO", "ASELS", "GARAN", "AKBNK", "KCHOL"];

async function main(): Promise<void> {
  console.log("=== BIST 100 OTOMATİK SENKRON DOĞRULAMA ===\n");

  // ============================================================
  // 1) Kaynak — güncel BIST 100 listesi çekimi.
  // ============================================================
  let constituents: Awaited<ReturnType<typeof fetchBist100Constituents>> = [];
  try {
    constituents = await fetchBist100Constituents();
  } catch (error: unknown) {
    const message = errBrief(error);
    if (isNetworkError(message)) {
      check(
        "Kaynak erişimi: atlandı (ağ erişimi yok)",
        true,
        "İş Yatırım kaynağına ulaşılamadı — senkron testleri atlandı.",
      );
      console.log(`\n=== SONUÇ: ${results.length}/${results.length} kontrol işlendi (ağ yok) ===`);
      return;
    }
    throw error;
  }

  assert(
    constituents.length >= 90 && constituents.length <= 110,
    `Beklenen ~100 bileşen geldi (${constituents.length}).`,
  );
  const symbols = constituents.map((c) => c.symbol);
  const knownHits = KNOWN_CORE_SYMBOLS.filter((s) => symbols.includes(s));
  assert(knownHits.length >= 3, `Bilinen çekirdek semboller listede yok (${knownHits.join(",")}).`);
  const withPrice = constituents.filter((c) => c.price !== null).length;
  check(
    "Kaynak: güncel BIST 100 listesi çekildi",
    true,
    `${constituents.length} bileşen, bilinen semboller: ${knownHits.join("/")}, fiyatlı: ${withPrice}`,
  );

  // Örnek bileşen detayı (ad ayrıştırma göstergesi).
  const sample =
    constituents.find((c) => c.symbol === "THYAO") ??
    constituents.find((c) => c.name.length > 0);
  assert(sample !== undefined, "Örnek bileşen bulunamadı.");
  assert(sample.name.length > 0, "Bileşen şirket adı boş ayrıştırıldı.");
  check(
    "Kaynak: 'SEMBOL - Ad' ayrıştırması",
    true,
    `${sample.symbol} → "${sample.name}"`,
  );

  // ============================================================
  // 2) Senkron öncesi durum — MANUAL kayıtlar sayılır.
  // ============================================================
  const manualBefore = await prisma.watchlist.count({ where: { source: "MANUAL" } });

  // ============================================================
  // 3) Senkron #1 — izleme listesi BIST 100 ile dolar.
  // ============================================================
  const sync1 = await syncBist100ToWatchlist();
  assert(
    sync1.fetchedCount === constituents.length,
    `Senkron fetchedCount kaynak ile aynı değil (${sync1.fetchedCount}).`,
  );
  assert(
    sync1.totalWatchlist >= constituents.length,
    `Senkron sonrası izleme listesi çok küçük (${sync1.totalWatchlist}).`,
  );
  check(
    "Senkron #1: BIST 100 izleme listesine yüklendi",
    true,
    `çekilen=${sync1.fetchedCount}, yeni=${sync1.addedCount}, toplam=${sync1.totalWatchlist}`,
  );

  // ============================================================
  // 4) MANUAL koruma — elle eklenen kayıtlar senkron sonrası da durur.
  // ============================================================
  const manualAfter = await prisma.watchlist.count({ where: { source: "MANUAL" } });
  assert(
    manualAfter >= manualBefore,
    `MANUAL kayıt sayısı azaldı (${manualBefore} → ${manualAfter}) — senkron kullanıcı verisine dokundu!`,
  );
  check(
    "MANUAL koruma: elle eklenen kayıtlar korunur",
    true,
    `önce=${manualBefore}, sonra=${manualAfter}`,
  );

  // ============================================================
  // 5) Stale temizleme — endeksten çıkan BIST100 kaydı düşer.
  // ============================================================
  const staleStock = await prisma.stock.upsert({
    where: { symbol: STALE_TEST_SYMBOL },
    update: {},
    create: { symbol: STALE_TEST_SYMBOL, name: "Senkron Test Hissesi", isActive: true },
  });
  await prisma.watchlist.upsert({
    where: { stockId: staleStock.id },
    update: { source: "BIST100" },
    create: { stockId: staleStock.id, source: "BIST100", autoAnalyze: false },
  });

  const sync2 = await syncBist100ToWatchlist();
  const staleStillThere = await prisma.watchlist.findUnique({
    where: { stockId: staleStock.id },
    select: { id: true },
  });
  assert(staleStillThere === null, "Endekste olmayan BIST100 kaydı senkron sonrası listede kaldı.");
  assert(
    sync2.addedCount === 0,
    `İkinci senkronda yeni ekleme olmamalı (${sync2.addedCount}).`,
  );
  assert(
    sync2.removedCount >= 1,
    `Stale kayıt senkron raporunda görünmedi (removed=${sync2.removedCount}).`,
  );
  check(
    "Stale temizleme + idempotentlik",
    true,
    `2. senkron: yeni=0, çıkarılan=${sync2.removedCount} (test kaydı ${STALE_TEST_SYMBOL} düştü)`,
  );

  // Test Stock kaydını tamamen temizle (iz bırakma).
  await prisma.stock.delete({ where: { symbol: STALE_TEST_SYMBOL } });

  // ============================================================
  // 6) Durum görünümü — status alanları dolu dönmeli.
  // ============================================================
  const status = await getBist100SyncStatus();
  assert(status.lastSyncedAt !== null, "Durum görünümünde lastSyncedAt boş.");
  assert(status.lastFetchedCount === sync2.fetchedCount, "Durumda fetchedCount taşınmadı.");
  assert(!status.isSyncing, "Senkron bitti ama durum hâlâ 'çalışıyor' gösteriyor.");
  check(
    "Durum görünümü: son senkron bilgisi dolu",
    true,
    `lastSyncedAt=${status.lastSyncedAt?.slice(0, 19)}, fetched=${status.lastFetchedCount}`,
  );

  // ============================================================
  // Özet.
  // ============================================================
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== SONUÇ: ${passed}/${results.length} kontrol geçti ===`);
  if (passed !== results.length) {
    throw new Error("Bazı kontroller başarısız — ✗ satırlarına bakın.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    if (error instanceof Bist100SyncError) {
      console.error("\n✗ BIST 100 senkron hatası:", error.message, `(kod: ${error.code})`);
    } else {
      console.error("\n✗ Script hata ile sonlandı:", errBrief(error));
    }
    await prisma.$disconnect();
    process.exit(1);
  });
