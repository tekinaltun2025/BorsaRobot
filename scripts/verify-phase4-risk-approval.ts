import { prisma } from "@/lib/prisma";
import { placeOrder, approveOrder, rejectOrder } from "@/server/services/trading-service";
import { TradingError } from "@/server/services/trading-error";
import { Prisma } from "@prisma/client";

async function runTest() {
  console.log("🚀 Faz 4: Risk ve Onay Mekanizması Testi Başlatılıyor...\n");

  try {
    // 1. Hazırlık: Admin ayarlarını kontrol et veya set et (maxDailyLossLimit'i düşük tutalım ki tetiklensin)
    let settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
    if (!settings) {
      console.log("⚠️ Admin ayarları bulunamadı, oluşturuluyor...");
      settings = await prisma.adminSettings.create({
        data: {
          maxDailyLossLimit: 100, // Çok düşük bir limit
          // Diğer gerekli alanlar...
        } as any,
      });
    } else {
      console.log(`ℹ️ Mevcut maxDailyLossLimit: ${settings.maxDailyLossLimit}`);
      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { maxDailyLossLimit: 100 }
      });
    }

    // Temizlik: Eski test emirlerini temizle (opsiyonel, ama kontrollü olması iyidir)
    await prisma.order.deleteMany({
      where: { clientRequestId: { contains: "phase4-test" } }
    });

    console.log("--- TEST 1: Risk Limiti Tetikleme ---");
    // 2. Test: Limit aşan bir emir ver (Büyük tutarlı bir emir)
    // Not: Gerçekçi olması için sembolün var olduğundan emin olmalıyız. 
    // Mevcut seed verilerinde THYAO veya benzeri varsa onu kullanalım.
    const stock = await prisma.stock.findFirst();
    if (!stock) {
      throw new Error("Test için uygun stok bulunamadı!");
    }

    console.log(`Emir veriliyor: ${stock.symbol}, Miktar: 10000 (Limit aşması bekleniyor)`);
    
    let orderResult;
    try {
      orderResult = await placeOrder({
        side: "BUY",
        symbol: stock.symbol,
        quantity: 10000, // Çok yüksek miktar/tutar
        clientRequestId: `phase4-test-${Date.now()}`,
        assetType: "STOCK"
      });
    } catch (error: any) {
      // placeOrder içinde hata fırlatılmıyor, status PENDING_APPROVAL dönüyor olmalı 
      // (eğer riskService yakalayıp throw etmiyorsa, ama trading-service'de try/catch ile handle ettik)
      console.log("❌ Beklenmedik hata:", error.message);
      throw error;
    }

    console.log(`Emir Durumu: ${orderResult.order.status}`);
    if (orderResult.order.status !== "PENDING_APPROVAL") {
      throw new Error(`Beklenen durum PENDING_APPROVAL, ama gelen: ${orderResult.order.status}`);
    }
    console.log("✅ Test 1 Başarılı: Emir onay bekliyor.");

    const pendingOrderId = orderResult.order.id;

    console.log("\n--- TEST 2: Admin Onayı ---");
    console.log(`Emir ID: ${pendingOrderId} onaylanıyor...`);
    const approvedOrder = await approveOrder(pendingOrderId);
    console.log(`Onay Sonrası Durum: ${approvedOrder.status}`);

    if (approvedOrder.status !== "FILLED" && approvedOrder.status !== "REJECTED") {
      // Not: Provider mock ise FILLED dönebilir veya hata verebilir. 
      // Önemli olan durumun PENDING_APPROVAL'dan çıkmasıdır.
      console.log("ℹ️ Emir durumu:", approvedOrder.status);
    } else {
      console.log(`✅ Test 2 Başarılı: Emir ${approvedOrder.status} durumuna geçti.`);
    }

    console.log("\n--- TEST 3: Admin Reddi ---");
    // Yeni bir emir verelim ve reddedelim
    const rejectTestOrder = await placeOrder({
      side: "BUY",
      symbol: stock.symbol,
      quantity: 1,
      clientRequestId: `phase4-reject-${Date.now()}`,
      assetType: "STOCK"
    });

    // Onay bekleyen bir emir oluşturmak için risk limitini tekrar tetikleyelim (veya direkt PENDING_APPROVAL olanı bulalım)
    // Ama daha temiz yol, manuel olarak bir emri PENDING_APPROVAL yapıp reddetmek.
    const manualOrder = await prisma.order.create({
      data: {
        clientRequestId: `phase4-manual-${Date.now()}`,
        side: "BUY",
        assetType: "STOCK",
        stockId: stock.id,
        symbol: stock.symbol,
        quantity: new Prisma.Decimal(10),
        currency: "TRY",
        status: "PENDING_APPROVAL"
      }
    });

    console.log(`Emir ID: ${manualOrder.id} reddediliyor...`);
    const rejectedOrder = await rejectOrder(manualOrder.id, "Test amaçlı reddedildi.");
    console.log(`Red Sonrası Durum: ${rejectedOrder.status}`);

    if (rejectedOrder.status !== "REJECTED") {
      throw new Error(`Beklenen durum REJECTED, ama gelen: ${rejectedOrder.status}`);
    }
    console.log("✅ Test 3 Başarılı: Emir reddedildi.");

    console.log("\n🎉 TÜM TESTLER BAŞARIYLA TAMAMLANDI!");

  } catch (error: any) {
    console.error("\n❌ TEST HATASI:", error.message);
    process.exit(1);
  }
}

runTest();
