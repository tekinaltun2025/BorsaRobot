// Yardımcı script: /trading sayfasının ekran görüntüsünü alır — header mod
// switch'leri (Sanal/Canlı + Otomatik/Manuel), checkbox'lı pozisyon tablosu ve
// seçili pozisyonla görünür durumdaki toplu satış çubuğu birlikte görünür.
// Kullanım: node scripts/take-trading-screen.js
// Port farklıysa: BASE_URL=http://localhost:3003 node scripts/take-trading-screen.js
// Not: Bu script yalnızca ekran görüntüsü üretir; verify script'lerinin parçası değildir.

const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "public/screenshots/trading.png";

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  try {
    await page.goto(`${BASE}/trading`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Header'daki PAPER/LIVE radiogroup görünür olmalı.
    const modeGroup = page.locator("[aria-label='Çalışma modu (Sanal/Canlı)']");
    if ((await modeGroup.count()) === 0) {
      throw new Error("Header PAPER/LIVE switch bulunamadı");
    }

    // Pozisyon tablosundaki ilk satır checkbox'ını seç → toplu satış çubuğu açılır.
    const rowCheckbox = page.locator("tbody input[type='checkbox']").first();
    if ((await rowCheckbox.count()) > 0) {
      await rowCheckbox.check();
      await page.waitForTimeout(600);
      const bulkBar = page.locator("text=pozisyon seçildi").first();
      if ((await bulkBar.count()) === 0) {
        throw new Error("Toplu satış çubuğu görünmedi");
      }
    } else {
      console.warn("Uyarı: pozisyon satırı yok — tablo çubuksuz görüntülenecek.");
    }

    await page.screenshot({ path: OUT, fullPage: true });
    console.log(`✓ ${OUT} (/trading — header switch'ler + seçili pozisyon + toplu sat çubuğu)`);
  } catch (error) {
    console.error("Hata:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
