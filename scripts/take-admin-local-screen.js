// Yardımcı script: /admin AI Ayarları sekmesinde "Local AI (Custom)" sağlayıcısını
// seçer; yerelde ayağa kaldırılan OpenAI-uyumlu mock /v1/models sunucusuna karşı
// "Modelleri Getir" akışını çalıştırır ve model dropdown'ının dolduğu durumu
// public/screenshots/admin-ai-local.png üzerine yazar.
// Kullanım: node scripts/take-admin-local-screen.js
// Port farklıysa: BASE_URL=http://localhost:3003 node scripts/take-admin-local-screen.js
// Not: Bu script yalnızca ekran görüntüsü üretir; verify script'lerinin parçası değildir.
// Cleanup: script bitince (başarı/hata fark etmeksizin) aiProvider + customBaseUrl
// script öncesi değerlerine döndürülür — aksi halde mock Base URL DB'de kalır ve
// auto-trade döngüsü ölü porta bağlanmaya çalışıp her tick'te FAILED üretir.

const http = require("node:http");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "public/screenshots/admin-ai-local.png";

/**
 * OpenAI-uyumlu /v1/models mock sunucusu — rastgele boş portta dinler.
 * Gerçek Ollama kurulu olmadan da "Modelleri Getir" akışının uçtan uca
 * çalıştığını kanıtlamak için kullanılır.
 */
function startMockModelsServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              { id: "gemma2:2b", object: "model" },
              { id: "llama3.2", object: "model" },
              { id: "mistral-7b-instruct", object: "model" },
              { id: "qwen2.5:7b", object: "model" },
            ],
          }),
        );
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => server.close(),
      });
    });
  });
}

(async () => {
  const mock = await startMockModelsServer();
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  // Script ÖNCESİ admin ayarlarını kaydet — finally'de geri yazmak için.
  // (selectOption/fill, admin UI onChange handler'larıyla DB'ye ANINDA yazar;
  //  cleanup yapılmazsa mock Base URL DB'de kalır ve auto-trade döngüsü ölü
  //  porta bağlanmaya çalışıp her tick'te FAILED döngüler üretir.)
  let savedProvider = null;
  let savedBaseUrl = null;
  try {
    const settingsRes = await fetch(`${BASE}/api/admin/settings`);
    if (settingsRes.ok) {
      const settings = await settingsRes.json();
      savedProvider = settings.aiProvider;
      savedBaseUrl = settings.customBaseUrl ?? "";
    } else {
      console.warn(`⚠ Admin ayarları okunamadı (HTTP ${settingsRes.status}) — cleanup atlanacak.`);
    }
  } catch (readError) {
    console.warn(
      "⚠ Admin ayarları okunamadı — cleanup atlanacak:",
      readError instanceof Error ? readError.message : readError,
    );
  }

  // Teşhis: admin API isteklerini ve tarayıcı konsol hatalarını logla.
  page.on("response", (res) => {
    if (res.url().includes("/api/admin/")) {
      console.log(`→ ${res.request().method()} ${res.url().replace(BASE, "")} ⇒ ${res.status()}`);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });

  try {
    // Sayfayı yükle — domcontentloaded + aktif sağlayıcı select'i görünene dek bekle.
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    const providerSelect = page.locator("select[aria-label='Aktif AI sağlayıcı']");
    await providerSelect.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(800);

    // "Aktif Sağlayıcı" dropdown'u → CUSTOM seç.
    await providerSelect.selectOption("CUSTOM");

    // CUSTOM bloğu render olana dek bekle: Base URL input'u görünür olmalı.
    const baseUrlInput = page.locator("#custom-base-url");
    await baseUrlInput.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);

    // Base URL alanına mock sunucu adresini gir; Tab ile blur tetikle (blur'da ayara kaydeder).
    await baseUrlInput.fill(mock.url);
    const typed = await baseUrlInput.inputValue();
    if (typed !== mock.url) {
      throw new Error(`Base URL fill doğrulanamadı (okunan: "${typed}")`);
    }
    await baseUrlInput.click();
    await page.keyboard.press("Tab"); // native blur → handleCustomBaseUrlBlur
    await page.waitForTimeout(1000);

    // "Modelleri Getir" → mock /v1/models listesi dropdown'a dolar.
    const fetchButton = page.locator("button", { hasText: "Modelleri Getir" });
    await fetchButton.waitFor({ state: "visible", timeout: 10000 });
    await fetchButton.click();

    // Başarı ("N model bulundu") veya hata (role=alert) mesajından ilk geleni bekle.
    const successMsg = page.locator("text=model bulundu").first();
    const errorMsg = page.locator("[role='alert']").first();
    await Promise.race([
      successMsg.waitFor({ state: "visible", timeout: 15000 }),
      errorMsg.waitFor({ state: "visible", timeout: 15000 }),
    ]);
    await page.waitForTimeout(500);

    // Model dropdown'ının gerçekten dolduğunu doğrula.
    const modelSelect = page.locator("#custom-model-select");
    if ((await modelSelect.count()) > 0) {
      const optionCount = await modelSelect.locator("option").count();
      console.log(`Model dropdown: ${optionCount} seçenek`);
      if (optionCount === 0) {
        throw new Error("Model dropdown boş — liste çekilemedi");
      }
    } else {
      throw new Error("Model dropdown (#custom-model-select) render edilmedi");
    }

    await page.screenshot({ path: OUT });
    console.log(`✓ ${OUT} (CUSTOM seçili, ${mock.url} üzerinden model listesi çekilmiş)`);
  } catch (error) {
    // Hata anındaki durumu kaydet — teşhis için.
    await page.screenshot({ path: "/tmp/admin-local-debug.png" }).catch(() => {});
    console.error("Hata:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    // Cleanup: script'in değiştirdiği ayarları (aiProvider + customBaseUrl)
    // eski değerlerine döndür. customApiKey/customModel'e DOKUNULMAZ — script
    // onları değiştirmez ve view'da maskeli döndükleri için geri yazılamazlar.
    // Sıralama önemli: önce Base URL geri yazılır (CUSTOM + boş URL
    // kombinasyonunun 422'ye düşmemesi için), sonra aiProvider.
    if (savedProvider !== null) {
      try {
        const urlRes = await fetch(`${BASE}/api/admin/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customBaseUrl: savedBaseUrl ?? "" }),
        });
        const providerRes = await fetch(`${BASE}/api/admin/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aiProvider: savedProvider }),
        });
        if (urlRes.ok && providerRes.ok) {
          console.log(`✓ Cleanup: ayarlar geri alındı (aiProvider=${savedProvider})`);
        } else {
          console.warn(
            `⚠ Cleanup PUT başarısız: customBaseUrl=${urlRes.status}, aiProvider=${providerRes.status}`,
          );
        }
      } catch (cleanupError) {
        console.warn(
          "⚠ Cleanup hatası:",
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
        );
      }
    }
    await browser.close();
    mock.close();
  }
})();
