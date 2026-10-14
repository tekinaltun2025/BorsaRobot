// Yardımcı script: /admin sayfasının 3 sekmesinin ayrı ekran görüntülerini alır.
// Kullanım: node scripts/take-admin-screens.js
// Not: Bu script yalnızca yardım sayfası görselleri için bir kez kullanılır;
// verify script'lerinin bir parçası değildir.

const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const OUT_DIR = "public/screenshots";

/** Sekme butonunu metnine göre tıklayıp görüntüyü kaydeder. */
async function captureTab(page, tabLabel, fileName) {
  const tabButton = page.locator("nav[aria-label='Admin paneli sekmeleri'] button", {
    hasText: tabLabel,
  });
  await tabButton.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/${fileName}` });
  console.log(`✓ ${fileName} (${tabLabel} sekmesi)`);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await captureTab(page, "AI Ayarları", "admin-ai.png");
    await captureTab(page, "Promptlar", "admin-prompts.png");
    await captureTab(page, "Risk & Mod", "admin-risk.png");
  } catch (error) {
    console.error("Hata:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
