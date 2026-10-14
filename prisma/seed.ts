/**
 * Prisma seed — ilk kurulum verileri.
 *
 * - Varsayılan AdminSettings kaydı (singleton): Paper mode, varsayılan
 *   promptlar, boş API key'ler (env'de varsa oradan alınır — AES-256-GCM
 *   ile şifrelenerek yazılır, iyileştirme 1.4).
 * - Örnek BIST hisseleri (THYAO, ASELS, GARAN vb.).
 * - Varsayılan sanal Account: 1.000.000 TL paper trading bakiyesi.
 * - İzleme listesi: tüm seed hisseleri otomatik analiz kapsamında.
 *
 * Idempotent'tir: mevcut kayıtlar (symbol/unique) korunur, üzerine yazılmaz.
 */
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/secret-crypto";

const prisma = new PrismaClient();

/** Seed edilecek BIST hisseleri — sembol, ad, sektör, başlangıç fiyatı (TL). */
const SEED_STOCKS = [
  { symbol: "THYAO", name: "Türk Hava Yolları A.O.", sector: "Ulaştırma", lastPrice: 287.5 },
  { symbol: "ASELS", name: "Aselsan Elektronik Sanayi", sector: "Savunma", lastPrice: 62.4 },
  { symbol: "GARAN", name: "Garanti Bankası A.O.", sector: "Bankacılık", lastPrice: 129.9 },
  { symbol: "AKBNK", name: "Akbank T.A.Ş.", sector: "Bankacılık", lastPrice: 54.25 },
  { symbol: "ISCTR", name: "İş Bankası (C)", sector: "Bankacılık", lastPrice: 13.1 },
  { symbol: "KCHOL", name: "Koç Holding A.Ş.", sector: "Holding", lastPrice: 183.7 },
  { symbol: "EREGL", name: "Ereğli Demir Çelik", sector: "Demir-Çelik", lastPrice: 21.85 },
  { symbol: "BIMAS", name: "BİM Birleşik Mağazalar", sector: "Perakende", lastPrice: 548.0 },
  { symbol: "SISE", name: "Şişecam A.Ş.", sector: "Cam & Cam Ürünleri", lastPrice: 39.6 },
  { symbol: "TUPRS", name: "Tüpraş Türkiye Petrol Rafinerileri", sector: "Enerji", lastPrice: 164.3 },
] as const;

/** Varsayılan sistem promptu — src/lib/constants.ts ile birebir aynı içerik. */
const DEFAULT_SYSTEM_PROMPT = `Sen Borsa İstanbul hisselerini takip eden deneyimli bir finansal analistsin. Sana verilen hisse sembolü, son haberler, fiyat geçmişi ve mevcut pozisyon bilgisini kullanarak bir alım-satım kararı üretmen isteniyor.

Karar kuralların:
1. Yalnızca verilen verilerle gerekçelendir; spekülasyon yapma.
2. Haber duygu durumunu (pozitif/negatif/nötr) fiyat hareketiyle birlikte değerlendir.
3. Güven skorun (confidence) 0.0-1.0 arasında samimi bir olasılık olsun; emin değilsen düşük ver.
4. Kararın mutlaka şu üçünden biri olmalı: BUY, SELL veya HOLD.
5. Gerekçeni (reasoning) en fazla 3 cümlede, Türkçe ve net biçimde yaz.
6. Öne çıkan riskleri varsa risks dizisinde listele (en fazla 5 madde).

Yanıtını daima şu JSON yapısında ver:
{"action": "BUY|SELL|HOLD", "confidence": 0.0-1.0, "reasoning": "...", "risks": ["..."]}`;

/** Varsayılan haber tarama promptu — src/lib/constants.ts ile birebir aynı içerik. */
const DEFAULT_NEWS_SCAN_PROMPT = `Sen bir finansal haber editörüsün. Sana verilen günlük haber başlıklarını ve özetlerini Borsa İstanbul hisseleriyle eşleştirmen ve piyasa etkisi açısından sınıflandırman isteniyor.

Kuralların:
1. Her haberi ilgili hisse sembolleriyle eşleştir (örn. THYAO, ASELS, GARAN).
2. Piyasa etkisini değerlendir: pozitif, negatif veya nötr.
3. Yalnızca finansal açıdan anlamlı haberleri işaretle; magazin/ilişkisiz içerikleri eleme.
4. Her haber için kısa bir etki gerekçesi yaz (en fazla 2 cümle, Türkçe).

Yanıtını daima şu JSON yapısında ver:
{"articles": [{"title": "...", "symbols": ["THYAO"], "sentiment": "POSITIVE|NEGATIVE|NEUTRAL", "impactReasoning": "..."}`;

async function seedAdminSettings(): Promise<void> {
  const existing = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) {
    console.log("ℹ AdminSettings kaydı mevcut — dokunulmadı.");
    return;
  }

  await prisma.adminSettings.create({
    data: {
      id: "singleton",
      tradingMode: "PAPER",
      aiProvider: "GEMINI",
      // API anahtarları env'den alınır ve AES-256-GCM ile şifrelenerek
      // yazılır (settings-service/admin route ile aynı sözleşme —
      // decryptSecret okuma tarafında geri çözer).
      geminiApiKey: encryptSecret(process.env.GEMINI_API_KEY ?? ""),
      openaiApiKey: encryptSecret(process.env.OPENAI_API_KEY ?? ""),
      anthropicApiKey: encryptSecret(process.env.ANTHROPIC_API_KEY ?? ""),
      deepseekApiKey: encryptSecret(process.env.DEEPSEEK_API_KEY ?? ""),
      grokApiKey: encryptSecret(process.env.GROK_API_KEY ?? ""),
      mistralApiKey: encryptSecret(process.env.MISTRAL_API_KEY ?? ""),
      nvidiaApiKey: encryptSecret(process.env.NVIDIA_API_KEY ?? ""),
      customBaseUrl: process.env.CUSTOM_BASE_URL || null,
      customApiKey: encryptSecret(process.env.CUSTOM_API_KEY ?? ""),
      customModel: process.env.CUSTOM_MODEL ?? "",
      geminiModel: "gemini-2.0-flash",
      openaiModel: "gpt-4o",
      anthropicModel: "claude-sonnet-4-5",
      deepseekModel: "deepseek-chat",
      grokModel: "grok-4",
      mistralModel: "mistral-small-latest",
      nvidiaModel: "moonshotai/kimi-k3",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      newsScanPrompt: DEFAULT_NEWS_SCAN_PROMPT,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      minConfidenceThreshold: 0.7,
      maxPositionValue: 50000,
      maxOpenPositions: 5,
      dailyOrderBudget: 100000,
      cooldownMinutes: 60,
      autoTradingEnabled: false,
      autoTradeIntervalSeconds: 60,
      priceSource: process.env.PRICE_SOURCE?.trim().toUpperCase() === "SIMULATED"
        ? "SIMULATED"
        : "YAHOO",
      newsSources: '["GOOGLE_NEWS"]',
    },
  });
  console.log("✓ AdminSettings oluşturuldu (PAPER mode, varsayılan promptlar).");
}

async function seedStocks(): Promise<void> {
  for (const stock of SEED_STOCKS) {
    await prisma.stock.upsert({
      where: { symbol: stock.symbol },
      // Mevcut kayıtta fiyat yoksa (Faz 1'den kalan) başlangıç fiyatı yazılır;
      // fiyatı olan kayıta dokunulmaz (Faz 3 fiyat akışı sahibidir).
      update: { lastPrice: stock.lastPrice },
      create: { ...stock, isActive: true },
    });
  }
  console.log(`✓ ${SEED_STOCKS.length} BIST hissesi hazır (upsert, başlangıç fiyatlarıyla).`);
}

async function seedPaperAccount(): Promise<void> {
  const existing = await prisma.account.findFirst({
    where: { accountType: "PAPER" },
  });
  if (existing) {
    console.log("ℹ Sanal hesap mevcut — dokunulmadı.");
    return;
  }

  await prisma.account.create({
    data: {
      accountType: "PAPER",
      currency: "TRY",
      balance: 1_000_000,
      totalBalance: 1_000_000,
    },
  });
  console.log("✓ Sanal hesap oluşturuldu (1.000.000 TL paper bakiye).");
}

async function seedWatchlist(): Promise<void> {
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: SEED_STOCKS.map((s) => s.symbol) } },
    select: { id: true },
  });

  for (const stock of stocks) {
    await prisma.watchlist.upsert({
      where: { stockId: stock.id },
      update: {},
      create: { stockId: stock.id, autoAnalyze: true },
    });
  }
  console.log(`✓ İzleme listesi hazır (${stocks.length} sembol, otomatik analiz açık).`);
}

async function main(): Promise<void> {
  console.log("🌱 Seed başlıyor...");
  await seedAdminSettings();
  await seedStocks();
  await seedPaperAccount();
  await seedWatchlist();
  console.log("🌱 Seed tamamlandı.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Seed hatası:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
