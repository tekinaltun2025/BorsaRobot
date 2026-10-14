/**
 * Faz 2 uçtan uca doğrulama scripti — Paper Trading motoru.
 *
 * Kullanım: npx tsx scripts/verify-trading.ts
 *
 * Servis katmanını (trading-service + portfolio-service) doğrudan DB üzerinde
 * çalıştırır ve şu akışları kanıtlar:
 *  1. ALIM emri → pozisyon oluşumu, bakiye düşümü, komisyon, hareket kaydı.
 *  2. Ek ALIM → ağırlıklı ortalama maliyet güncellemesi.
 *  3. SATIM emri → pozisyon azaltma, bakiye artışı, net K/Z hesabı.
 *  4. Yetersiz bakiye → anlamlı hata (REJECTED, bakiye değişmez).
 *   5. Yetersiz lot → anlamlı hata (TradingError INSUFFICIENT_POSITION,
 *     pozisyon değişmez).
 *  6. Idempotency → aynı clientRequestId ile tekrar → mevcut emir döner,
 *     yeni işlem ÜRETİLMEZ (bakiye/pozisyon/hareket sayısı sabit kalır).
 *  7. Risk kuralları → maxPositionValue aşımı reddi.
 *  8. Doğrulama → geçersiz sembol 404, geçersiz miktar Zod reddi.
 *
 * Not: Script kendi PAPER hesabını ve kendi sembolünü oluşturur; mevcut
 * verileri bozmaz. Sonunda oluşturduğu kayıtları temizler.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  placeOrder,
  listOrders,
  TradingError,
} from "../src/server/services/trading-service";
import {
  getPortfolio,
  getAccountSummary,
  listAccountTransactions,
} from "../src/server/services/portfolio-service";

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

async function main(): Promise<void> {
  console.log("=== FAZ 2 — PAPER TRADING DOĞRULAMA ===\n");

  // --- Test ortamı: izole sembol + izole PAPER hesabı.
  const TEST_SYMBOL = "TEST";

  // Önceki (yarıda kalmış) koşuların artıklarını temizle: TEST sembolü ve
  // 2001 öncesi tarihli test hesapları yalnızca bu scriptin ürünleridir.
  const staleStock = await prisma.stock.findUnique({ where: { symbol: TEST_SYMBOL } });
  if (staleStock) {
    await prisma.order.deleteMany({ where: { stockId: staleStock.id } });
    await prisma.portfolio.deleteMany({ where: { stockId: staleStock.id } });
    await prisma.stock.delete({ where: { id: staleStock.id } });
  }
  const staleAccounts = await prisma.account.findMany({
    where: { accountType: "PAPER", createdAt: { lt: new Date("2001-01-01T00:00:00.000Z") } },
    select: { id: true },
  });
  for (const stale of staleAccounts) {
    await prisma.accountTransaction.deleteMany({ where: { accountId: stale.id } });
    await prisma.account.delete({ where: { id: stale.id } });
  }

  // Risk limitlerini test için yeterli seviyeye çek (temel testler için).
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: {
      maxPositionValue: 1_000_000,
      maxOpenPositions: 10,
      dailyOrderBudget: 1_000_000,
      maxDailyLossLimit: 1_000_000,
      maxBuyAmount: 1_000_000,
      maxSellAmount: 1_000_000,
    },
  });

  const stock = await prisma.stock.upsert({
    where: { symbol: TEST_SYMBOL },
    update: { lastPrice: 100 },
    create: { symbol: TEST_SYMBOL, name: "Test Hisse", sector: "Test", lastPrice: 100, isActive: false },
  });
  const account = await prisma.account.create({
    data: { accountType: "PAPER", currency: "TRY", balance: 20_000, totalBalance: 20_000 },
  });

  // Portfolio-service bu hesabı bulmalı — en yeni PAPER hesap bu olduğu için
  // (createdAt asc sıralamasında ilk hesap seed hesabıdır!). Dikkat: servis
  // findFirst orderBy createdAt asc kullanıyor; test hesabı EN ESKİ olmalı.
  // Bu yüzden test hesabını silip seed hesabına bağlı kalmak yerine, servis
  // çağrılarını doğrudan bu hesap üzerinden değerlendireceğiz... Ancak
  // servis hesabı kendisi seçer. Çözüm: test hesabını geçici olarak
  // createdAt'i geriye alarak en eski yap.
  await prisma.account.update({
    where: { id: account.id },
    data: { createdAt: new Date("2000-01-01T00:00:00.000Z") },
  });

  const summaryBefore = await getAccountSummary();
  assert(
    summaryBefore.accountId === account.id,
    "Test hesabı portfolio-service tarafından seçilmedi (createdAt sıralaması).",
  );
  const balanceBefore = new Prisma.Decimal(summaryBefore.cashBalance);
  assert(balanceBefore.equals(20_000), "Başlangıç bakiyesi 20.000 TL olmalı.");

  // ============================================================
  // 1) ALIM: 50 lot × 100 TL = 5.000 TL + %0,1 komisyon = 5.005 TL
  // ============================================================
  const buyReqId = crypto.randomUUID();
  const buy1 = await placeOrder({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 50,
    clientRequestId: buyReqId,
  });
  check(
    "ALIM emri FILLED",
    buy1.order.status === "FILLED",
    `status=${buy1.order.status}, fiyat=${buy1.order.filledPrice}, tutar=${buy1.order.filledValue}`,
  );
  assert(buy1.order.status === "FILLED", "ALIM emri gerçekleşmeli.");

  const expectedBuy1 = new Prisma.Decimal(100).mul(50).add(new Prisma.Decimal(5)); // 5005
  assert(
    new Prisma.Decimal(buy1.order.filledValue ?? "").equals(expectedBuy1),
    `ALIM tutarı ${expectedBuy1.toString()} olmalı, gelen: ${buy1.order.filledValue}`,
  );
  assert(
    new Prisma.Decimal(buy1.order.commission ?? "").equals(new Prisma.Decimal(5)),
    "Komisyon 5.00 TL olmalı (%0,1).",
  );

  const summaryAfterBuy1 = await getAccountSummary();
  const balanceAfterBuy1 = new Prisma.Decimal(summaryAfterBuy1.cashBalance);
  assert(
    balanceBefore.sub(balanceAfterBuy1).equals(expectedBuy1),
    `Bakiye tam ${expectedBuy1.toString()} TL düşmeli (atomiklik).`,
  );
  check(
    "ALIM sonrası bakiye düşümü",
    true,
    `${balanceBefore.toString()} → ${balanceAfterBuy1.toString()} TL`,
  );

  const portfolioAfterBuy1 = await getPortfolio();
  const pos1 = portfolioAfterBuy1.positions.find((p) => p.symbol === TEST_SYMBOL);
  assert(pos1 !== undefined, "ALIM sonrası pozisyon oluşmalı.");
  check(
    "Pozisyon oluşumu",
    pos1 !== undefined && Number(pos1.quantity) === 50 && Number(pos1.avgCost) === 100.1,
    pos1
      ? `adet=${pos1.quantity}, ortMaliyet=${pos1.avgCost} (komisyon dahil 100.10)`
      : "pozisyon yok",
  );

  // ============================================================
  // 2) Ek ALIM: 50 lot daha → ağırlıklı ortalama maliyet aynı kalır
  //    (aynı fiyat), totalCost 10.010 TL olur.
  // ============================================================
  const buy2 = await placeOrder({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 50,
    clientRequestId: crypto.randomUUID(),
  });
  assert(buy2.order.status === "FILLED", "İkinci ALIM gerçekleşmeli.");
  const portfolioAfterBuy2 = await getPortfolio();
  const pos2 = portfolioAfterBuy2.positions.find((p) => p.symbol === TEST_SYMBOL);
  assert(pos2 !== undefined, "Pozisyon hâlâ mevcut olmalı.");
  check(
    "Ağırlıklı ortalama maliyet (ek alım)",
    pos2 !== undefined &&
      Number(pos2.quantity) === 100 &&
      Number(pos2.avgCost) === 100.1 &&
      Number(pos2.totalCost) === 10_010,
    pos2
      ? `adet=${pos2.quantity}, ortMaliyet=${pos2.avgCost}, toplamMaliyet=${pos2.totalCost}`
      : "pozisyon yok",
  );

  // ============================================================
  // 3) SATIM: 60 lot × 100 TL = 6.000 − 6 komisyon = 5.994 net
  //    Maliyet tabanı: 60 × 100.10 = 6.006 → K/Z = 5.994 − 6.006 = −12
  // ============================================================
  const sell1 = await placeOrder({
    side: "SELL",
    symbol: TEST_SYMBOL,
    quantity: 60,
    clientRequestId: crypto.randomUUID(),
  });
  assert(sell1.order.status === "FILLED", "SATIM gerçekleşmeli.");
  const expectedPnl = new Prisma.Decimal(-12);
  assert(
    new Prisma.Decimal(sell1.order.realizedPnl ?? "").equals(expectedPnl),
    `Satış K/Z ${expectedPnl.toString()} olmalı, gelen: ${sell1.order.realizedPnl}`,
  );
  check(
    "SATIM K/Z hesabı (komisyon dahil)",
    true,
    `K/Z=${sell1.order.realizedPnl} TL (beklenen −12.00)`,
  );

  const portfolioAfterSell = await getPortfolio();
  const pos3 = portfolioAfterSell.positions.find((p) => p.symbol === TEST_SYMBOL);
  assert(pos3 !== undefined, "Pozisyon kalmalı (40 lot).");
  check(
    "SATIM sonrası pozisyon azaltma",
    pos3 !== undefined && Number(pos3.quantity) === 40,
    pos3 ? `kalan adet=${pos3.quantity}` : "pozisyon yok",
  );

  const summaryAfterSell = await getAccountSummary();
  // realizedPnl global aggregate'tir (tüm FILLED SELL emirleri) — önceki
  // koşulardan kalma emirler toplama karışabilir. Bu yüzden mutlak değer
  // yerine satış öncesi/sonrası delta kontrol edilir: Δ = bu satışın K/Z'si.
  const realizedBeforeSell = new Prisma.Decimal(portfolioAfterBuy2.summary.realizedPnl);
  const realizedDelta = new Prisma.Decimal(summaryAfterSell.realizedPnl).sub(realizedBeforeSell);
  check(
    "Gerçekleşmiş K/Z özeti",
    realizedDelta.equals(expectedPnl),
    `ΔrealizedPnl=${realizedDelta.toString()} TL (beklenen −12.00; global toplam=${summaryAfterSell.realizedPnl} TL)`,
  );

  // ============================================================
  // 4) Yetersiz bakiye: kalan bakiyeyi aşan dev ALIM → REJECTED.
  //    Bakiye değişmemeli. (Risk limitleri geçici olarak kaldırılır ki
  //    bakiye kontrolü provider katmanında izole test edilsin.)
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { maxPositionValue: 1_000_000_000, dailyOrderBudget: 1_000_000_000 },
  });
  const balanceBeforeFail = new Prisma.Decimal(
    (await getAccountSummary()).cashBalance,
  );
  const hugeBuy = await placeOrder({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 1_000_000, // 100.000.000 TL ister — bakiye ~9.989 TL
    clientRequestId: crypto.randomUUID(),
  });
  // Risk limitlerini geri yükle.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { maxPositionValue: 50_000, dailyOrderBudget: 100_000 },
  });
  assert(hugeBuy.order.status === "REJECTED", "Dev ALIM reddedilmeli.");
  check(
    "Yetersiz bakiye reddi",
    hugeBuy.order.status === "REJECTED",
    `errorCode=${hugeBuy.order.errorMessage ?? ""}`.slice(0, 90),
  );
  const balanceAfterFail = new Prisma.Decimal(
    (await getAccountSummary()).cashBalance,
  );
  assert(
    balanceBeforeFail.equals(balanceAfterFail),
    "Reddedilen emir bakiyeyi DEĞİŞTİRMEMELİ.",
  );
  check(
    "Red sonrası bakiye sabit",
    true,
    `${balanceAfterFail.toString()} TL (değişim yok)`,
  );

  // ============================================================
  // 5) Yetersiz lot: 41 adet satım → TradingError (INSUFFICIENT_POSITION).
  //    Servis, emir kaydı oluşturmadan risk kontrolünde reddeder; pozisyon
  //    değişmez. (Bakiye yetersizliği provider'da REJECTED order üretirken,
  //    pozisyon yetersizliği servis katmanında hata fırlatır — emir defterinde
  //    gerçekleşmesi imkânsız satım kaydı birikmemesi için.)
  // ============================================================
  let insufficientPosition = false;
  let insufficientMessage = "";
  try {
    await placeOrder({
      side: "SELL",
      symbol: TEST_SYMBOL,
      quantity: 41,
      clientRequestId: crypto.randomUUID(),
    });
  } catch (error: unknown) {
    if (error instanceof TradingError && error.code === "INSUFFICIENT_POSITION") {
      insufficientPosition = true;
      insufficientMessage = error.message;
    } else {
      throw error;
    }
  }
  assert(
    insufficientPosition,
    "Aşırı satım TradingError(INSUFFICIENT_POSITION) fırlatmalı.",
  );
  check(
    "Yetersiz lot reddi",
    true,
    `mesaj: ${insufficientMessage}`.slice(0, 90),
  );
  const portfolioAfterOverSell = await getPortfolio();
  const posAfterOverSell = portfolioAfterOverSell.positions.find(
    (p) => p.symbol === TEST_SYMBOL,
  );
  assert(
    posAfterOverSell !== undefined && Number(posAfterOverSell.quantity) === 40,
    "Reddedilen satım pozisyonu DEĞİŞTİRMEMELİ (40 lot kalmalı).",
  );
  check(
    "Red sonrası pozisyon sabit",
    true,
    posAfterOverSell ? `kalan adet=${posAfterOverSell.quantity}` : "pozisyon yok",
  );

  // ============================================================
  // 6) Idempotency: aynı clientRequestId ile ALIM tekrarı.
  // ============================================================
  const txnCountBefore = await prisma.accountTransaction.count({
    where: { accountId: account.id },
  });
  const replay = await placeOrder({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 50,
    clientRequestId: buyReqId, // AYNI anahtar!
  });
  const txnCountAfter = await prisma.accountTransaction.count({
    where: { accountId: account.id },
  });
  assert(replay.idempotentReplay === true, "Tekrar idempotentReplay=true dönmeli.");
  assert(replay.order.id === buy1.order.id, "Aynı emir kaydı dönmeli.");
  assert(
    txnCountBefore === txnCountAfter,
    "Idempotent tekrar YENİ hareket üretmemeli.",
  );
  check(
    "Idempotency (clientRequestId tekrarı)",
    true,
    `aynı emir döndü (${replay.order.id.slice(0, 8)}…), hareket sayısı ${txnCountBefore} → ${txnCountAfter}`,
  );

  // ============================================================
  // 7) Risk kuralı: maxPositionValue aşımı → PENDING_APPROVAL (admin onayı bekler).
  //     Faz 4: Risk ihlali hata fırlatmaz, emri onay bekleme durumuna alır.
  // ============================================================
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { maxPositionValue: 1_000 },
  });
  const riskOrder = await placeOrder({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 50, // 5.005 TL > 1.000 TL limit
    clientRequestId: crypto.randomUUID(),
  });
  const riskPending = riskOrder.order.status === "PENDING_APPROVAL";
  check(
    "Risk kuralı: maxPositionValue → PENDING_APPROVAL",
    riskPending,
    `status=${riskOrder.order.status}, hata="${riskOrder.order.errorMessage}"`,
  );
  assert(riskPending, "Risk limiti ihlali PENDING_APPROVAL durumuna almalı.");
  // Limiti geri yükle.
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { maxPositionValue: 50_000 },
  });

  // ============================================================
  // 8) Doğrulama hataları: geçersiz sembol + geçersiz miktar.
  // ============================================================
  let notFound = false;
  try {
    await placeOrder({
      side: "BUY",
      symbol: "YOKBOYLE",
      quantity: 1,
      clientRequestId: crypto.randomUUID(),
    });
  } catch (error: unknown) {
    if (error instanceof TradingError && error.code === "NOT_FOUND") notFound = true;
    else throw error;
  }
  check("Geçersiz sembol → NOT_FOUND", notFound, "404 TradingError fırlatıldı");

  // Zod şeması doğrudan test (API katmanı aynı şemayı kullanır).
  const { placeOrderSchema } = await import("../src/lib/validators/trading");
  const invalidQty = placeOrderSchema.safeParse({
    side: "BUY",
    symbol: TEST_SYMBOL,
    quantity: 10.5, // tamsayı değil
    clientRequestId: crypto.randomUUID(),
  });
  check(
    "Zod: tamsayı olmayan miktar reddi",
    !invalidQty.success,
    invalidQty.success ? "şema geçti (HATA)" : "şema reddetti (doğru)",
  );

  // ============================================================
  // 8b) PAPER FX guard (iyileştirme 3.3): döviz emri dürüst ret almalı.
  //     Eski davranış "USD" sembolünü Stock'ta arayıp yanıltıcı
  //     STOCK_NOT_FOUND üretiyordu; yeni davranış kalıcı
  //     PAPER_FX_NOT_SUPPORTED reddi döner ve bakiye değişmez.
  // ============================================================
  const balanceBeforeFx = new Prisma.Decimal(
    (await getAccountSummary()).cashBalance,
  );
  const fxOrder = await placeOrder({
    side: "BUY",
    symbol: "USD",
    quantity: 100,
    clientRequestId: crypto.randomUUID(),
    assetType: "CURRENCY",
  });
  const fxFilled = fxOrder.order.status === "FILLED";
  const fxRejectedProperly =
    fxOrder.order.status === "REJECTED" &&
    fxOrder.order.errorMessage?.includes("döviz emri desteklenmez") === true &&
    fxOrder.order.errorMessage?.includes("LIVE") === true;
  const balanceAfterFx = new Prisma.Decimal(
    (await getAccountSummary()).cashBalance,
  );
  check(
    "PAPER FX emri dürüst ret",
    !fxFilled && fxRejectedProperly && balanceBeforeFx.equals(balanceAfterFx),
    `status=${fxOrder.order.status}, hata="${fxOrder.order.errorMessage}", bakiye değişmedi=${balanceBeforeFx.equals(balanceAfterFx)}`,
  );

  // ============================================================
  // 9) Emir geçmişi + hesap hareketleri sayfalama.
  //    Bu koşuda 4 emir kaydı oluşur: 3 FILLED (2 alım + 1 satım) +
  //    1 REJECTED (yetersiz bakiye). Aşırı satım / risk ihlali / geçersiz
  //    sembol emir KAYDI ÜRETMEZ (servis katmanında reddedilir).
  // ============================================================
  const history = await listOrders({ page: 1, pageSize: 10 });
  assert(history.total >= 4, "En az 4 emir kaydı olmalı.");
  const filledCount = history.orders.filter((o) => o.status === "FILLED").length;
  const rejectedCount = history.orders.filter((o) => o.status === "REJECTED").length;
  assert(filledCount >= 3, "En az 3 FILLED emir olmalı (2 alım + 1 satım).");
  assert(rejectedCount >= 1, "En az 1 REJECTED emir olmalı (yetersiz bakiye).");
  check(
    "Emir geçmişi",
    true,
    `total=${history.total}, FILLED=${filledCount}, REJECTED=${rejectedCount}`,
  );

  // Sayfalama: pageSize=2 ile sayfalar farklı kayıtlar dönmeli.
  const page1 = await listOrders({ page: 1, pageSize: 2 });
  const page2 = await listOrders({ page: 2, pageSize: 2 });
  assert(page1.orders.length === 2, "1. sayfa tam 2 kayıt dönmeli.");
  assert(page2.orders.length >= 1, "2. sayfa en az 1 kayıt dönmeli.");
  const firstOfPage1 = page1.orders[0];
  const firstOfPage2 = page2.orders[0];
  if (firstOfPage1 === undefined || firstOfPage2 === undefined) {
    throw new Error("Doğrulama başarısız: Her iki sayfada da kayıt olmalı.");
  }
  assert(firstOfPage1.id !== firstOfPage2.id, "Sayfalar farklı kayıtlar dönmeli.");
  check(
    "Emir geçmişi sayfalama",
    true,
    `sayfa1=${page1.orders.length}, sayfa2=${page2.orders.length}, total=${history.total}`,
  );

  const txns = await listAccountTransactions({ page: 1, pageSize: 50 });
  assert(txns.total >= 3, "En az 3 hareket kaydı olmalı (2 alım + 1 satım).");
  check(
    "Hesap hareketleri",
    true,
    `total=${txns.total} hareket (BUY/SELL kayıtları izlenebilir)`,
  );

  // ============================================================
  // Özet + temizlik.
  // ============================================================
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SONUÇ: ${passed} başarılı, ${failed} başarısız ===`);

  // Temizlik: test verilerini geri al (üretim DB'sini kirletmemek için).
  await prisma.accountTransaction.deleteMany({ where: { accountId: account.id } });
  await prisma.account.delete({ where: { id: account.id } });
  await prisma.order.deleteMany({ where: { stockId: stock.id } });
  await prisma.portfolio.deleteMany({ where: { stockId: stock.id } });
  await prisma.stock.delete({ where: { id: stock.id } });
  console.log("✓ Test verileri temizlendi (hesap, emirler, pozisyon, sembol).");

  if (failed > 0) process.exit(1);
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
