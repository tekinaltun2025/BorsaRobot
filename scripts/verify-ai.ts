/**
 * Faz 4 uçtan uca doğrulama scripti — LLM duygu analizi + haber taraması.
 *
 * Kullanım: npx tsx scripts/verify-ai.ts  (veya npm run verify:ai)
 *
 * API key GEREKMEZ: tüm LLM çağrıları bu script içinde tanımlı mock
 * provider ile simüle edilir (mock yalnızca test script'inde yaşar —
 * production koduna girmez).
 *
 * Doğrulanan akışlar:
 *  1. Parser: code fence temizliği, gömülü JSON extract, Zod doğrulama.
 *  2. Zod reddi: geçersiz action / aralık dışı confidence / JSON yok.
 *  3. Retry: bozuk ilk yanıt hata geri beslemesiyle düzelir (attempts=2);
 *     iki deneme de bozuksa anlamlı LlmParseError; temiz yanıtta retry yok.
 *  4. Factory: key'siz yapılandırmada LlmConfigError (TR yönlendirme).
 *  5. Prompt kurma: enjeksiyon koruması işaretleri + veri blokları.
 *  6. Dedup: hashUrl determinizmi + urlHash unique constraint (P2002).
 *  7. AiAnalysisLog: mock analiz kaydı oluşturulur ve listelenir.
 *  8. Rate limit: cooldown aktifken analyzeStock COOLDOWN (429) fırlatır
 *     (LLM çağrısına hiç gitmeden); key yoksa MISSING_API_KEY (400).
 *
 * Not: Script kendi test sembolünü (TSTX) oluşturur ve sonunda temizler;
 * AdminSettings.cooldownMinutes geçici olarak 5 yapılır ve geri yüklenir.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  stripCodeFences,
  extractJsonObject,
  parseAndValidate,
  parseLlmAnalysisWithRetry,
} from "../src/server/services/llm-response-parser";
import {
  aiAnalysisSchema,
  type ValidatedAiAnalysis,
} from "../src/lib/validators/ai-analysis";
import {
  LlmConfigError,
  LlmParseError,
  type ILlmProvider,
} from "../src/server/providers/llm-provider";
import {
  createLlmProvider,
  getLlmProviderConfig,
} from "../src/server/providers/llm-provider-factory";
import {
  AnalysisServiceError,
  analyzeStock,
  buildAnalysisDataPrompt,
  checkAnalysisCooldown,
  listAnalysesForStock,
} from "../src/server/services/analysis-service";
import { hashUrl } from "../src/server/providers/google-news-scraper";
import { getOrCreateAdminSettings } from "../src/server/services/settings-service";
import type { AiProvider } from "../src/lib/types";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-market.ts deseni. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Hatayı kısa tanımla (log okunabilirliği). */
function errBrief(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mock LLM provider — yalnızca bu script'te tanımlıdır.
 * Kuyruktan sırayla önceden belirlenmiş ham yanıtlar döndürür;
 * ILlmProvider sözleşmesini birebir uygular.
 */
class MockLlmProvider implements ILlmProvider {
  readonly providerId: AiProvider = "GEMINI";
  readonly model = "mock-analysis-model";
  private readonly queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async generateStructured(
    _prompt: string,
    _systemPrompt: string,
  ): Promise<string> {
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("Mock yanıt kuyruğu tükendi — beklenmeyen ek LLM çağrısı.");
    }
    return next;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock sağlayıcı: bağlantı her zaman başarılı." };
  }
}

/** Mock provider'ı parser'ın LlmTextGenerator sözleşmesine bağlar. */
function bindMock(
  mock: MockLlmProvider,
): (prompt: string, systemPrompt: string) => Promise<string> {
  return (prompt: string, systemPrompt: string): Promise<string> =>
    mock.generateStructured(prompt, systemPrompt);
}

// --- Temizlik durumu (her çıkış yolunda geri yüklenir).
let testStockId: string | null = null;
let originalCooldownMinutes: number | null = null;

const TEST_SYMBOL = "TSTX";

/** Test sembolüne bağlı tüm kayıtları ve ayar değişikliğini geri alır. */
async function cleanup(): Promise<void> {
  try {
    if (testStockId !== null) {
      const stock = await prisma.stock.findUnique({
        where: { id: testStockId },
      });
      if (stock) {
        await prisma.aiAnalysisLog.deleteMany({ where: { stockId: stock.id } });
        await prisma.newsArticle.deleteMany({ where: { stockId: stock.id } });
        await prisma.priceHistory.deleteMany({ where: { stockId: stock.id } });
        await prisma.watchlist.deleteMany({ where: { stockId: stock.id } });
        await prisma.portfolio.deleteMany({ where: { stockId: stock.id } });
        await prisma.stock.delete({ where: { id: stock.id } });
        console.log(`\nTemizlik: ${TEST_SYMBOL} ve bağlı kayıtları silindi.`);
      }
    }
    if (originalCooldownMinutes !== null) {
      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { cooldownMinutes: originalCooldownMinutes },
      });
      console.log(
        `Temizlik: cooldownMinutes=${originalCooldownMinutes} geri yüklendi.`,
      );
    }
  } catch (error: unknown) {
    console.error("Temizlik sırasında hata:", errBrief(error));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("=== FAZ 4 — LLM ANALİZ + HABER DOĞRULAMA (mock) ===\n");

  // --- Ortam temizliği: önceki koşu artıkları.
  const stale = await prisma.stock.findUnique({
    where: { symbol: TEST_SYMBOL },
  });
  if (stale) {
    await prisma.aiAnalysisLog.deleteMany({ where: { stockId: stale.id } });
    await prisma.newsArticle.deleteMany({ where: { stockId: stale.id } });
    await prisma.priceHistory.deleteMany({ where: { stockId: stale.id } });
    await prisma.watchlist.deleteMany({ where: { stockId: stale.id } });
    await prisma.portfolio.deleteMany({ where: { stockId: stale.id } });
    await prisma.stock.delete({ where: { id: stale.id } });
  }

  // ============================================================
  // 1) Parser — code fence temizliği + gömülü JSON + Zod.
  // ============================================================
  const fencedJson =
    '```json\n{"action":"BUY","confidence":0.75,"reasoning":"Güçlü yükseliş trendi ve olumlu haber akışı."}\n```';
  const stripped = stripCodeFences(fencedJson);
  assert(
    stripped.startsWith("{") && stripped.endsWith("}"),
    "stripCodeFences fence'leri soyamadı.",
  );
  check(
    "stripCodeFences: ```json fence soyulur",
    true,
    `"${stripped.slice(0, 40)}…"`,
  );

  const chatty =
    'Elbette! İşte analizim:\n{"action":"HOLD","confidence":0.4,"reasoning":"Nötr görünüm."}\n\nUmarım yardımcı olmuşumdur.';
  const extracted = extractJsonObject(chatty);
  assert(extracted !== null, "extractJsonObject gömülü JSON'u bulamadı.");
  const extractedAction =
    extracted !== null
      ? (JSON.parse(extracted) as { action: string }).action
      : "";
  assert(extractedAction === "HOLD", "Gömülü JSON içeriği yanlış extract edildi.");
  check(
    "extractJsonObject: konuşma metnine gömülü JSON bulunur",
    true,
    `action=${extractedAction}`,
  );

  const valid = parseAndValidate(fencedJson, aiAnalysisSchema);
  assert(
    valid.action === "BUY" && valid.confidence === 0.75,
    "parseAndValidate geçerli çıktıyı yanlış doğruladı.",
  );
  assert(valid.risks === undefined, "Verilmeyen risks alanı dolu geldi.");
  check(
    "parseAndValidate: fence'li geçerli analiz doğrulanır",
    true,
    `action=${valid.action}, confidence=${valid.confidence}`,
  );

  // Zod reddi — geçersiz action.
  let rejectedAction = false;
  try {
    parseAndValidate(
      '{"action":"PURCHASE","confidence":0.5,"reasoning":"x"}',
      aiAnalysisSchema,
    );
  } catch (error: unknown) {
    rejectedAction = error instanceof LlmParseError;
  }
  assert(rejectedAction, "Geçersiz action ('PURCHASE') Zod tarafından reddedilmedi.");
  check("Zod reddi: geçersiz action reddedilir", true, "PURCHASE → LlmParseError");

  // Zod reddi — aralık dışı confidence.
  let rejectedConfidence = false;
  try {
    parseAndValidate(
      '{"action":"BUY","confidence":1.5,"reasoning":"x"}',
      aiAnalysisSchema,
    );
  } catch (error: unknown) {
    rejectedConfidence = error instanceof LlmParseError;
  }
  assert(rejectedConfidence, "confidence=1.5 (aralık dışı) reddedilmedi.");
  check("Zod reddi: confidence=1.5 reddedilir", true, "0-1 aralığı zorunlu");

  // Zod reddi — JSON yok.
  let rejectedNoJson = false;
  try {
    parseAndValidate("Maalesef bu hisseyi analiz edemem.", aiAnalysisSchema);
  } catch (error: unknown) {
    rejectedNoJson = error instanceof LlmParseError;
  }
  assert(rejectedNoJson, "JSON içermeyen yanıt reddedilmedi.");
  check("Zod reddi: JSON olmayan yanıt reddedilir", true, "LlmParseError");

  // ============================================================
  // 2) Retry akışı — mock provider ile (network'süz).
  // ============================================================
  const mockRetry = new MockLlmProvider([
    'Hmm, emin değilim... {"action":"BELIRSIZ","confidence":2}',
    '{"action":"SELL","confidence":0.62,"reasoning":"Retry sonrası düzeltilmiş analiz.","risks":["Düşük likidite","Kur oynaklığı"]}',
  ]);
  const retryResult = await parseLlmAnalysisWithRetry(
    bindMock(mockRetry),
    "TEST-DATA-PROMPT",
    "TEST-SYSTEM-PROMPT",
  );
  assert(retryResult.attempts === 2, "Bozuk ilk yanıtta retry tetiklenmedi.");
  assert(retryResult.analysis.action === "SELL", "Retry sonrası analiz yanlış.");
  assert(
    (retryResult.analysis.risks?.length ?? 0) === 2,
    "Retry analizinde risks kayboldu.",
  );
  check(
    "Retry: bozuk ilk yanıt → hata geri beslemesi → düzelir",
    true,
    `attempts=${retryResult.attempts}, action=${retryResult.analysis.action}`,
  );

  const mockFail = new MockLlmProvider(["bozuk yanıt bir", "bozuk yanıt iki"]);
  let doubleFailMessage = "";
  try {
    await parseLlmAnalysisWithRetry(bindMock(mockFail), "P", "S");
  } catch (error: unknown) {
    doubleFailMessage = error instanceof LlmParseError ? error.message : "";
  }
  assert(
    doubleFailMessage.includes("iki denemede"),
    "İki başarısız denemede anlamlı hata mesajı üretilmedi.",
  );
  check(
    "Retry: iki deneme de bozuksa anlamlı LlmParseError",
    true,
    doubleFailMessage.slice(0, 60),
  );

  const mockClean = new MockLlmProvider([
    '{"action":"HOLD","confidence":0.5,"reasoning":"Tek denemede doğrulandı."}',
  ]);
  const cleanResult = await parseLlmAnalysisWithRetry(bindMock(mockClean), "P", "S");
  assert(cleanResult.attempts === 1, "Temiz yanıtta gereksiz retry yapıldı.");
  check("Retry: temiz ilk yanıtta retry tetiklenmez", true, "attempts=1");

  // ============================================================
  // 3) Factory — key'siz yapılandırma reddi.
  // ============================================================
  let geminiRejected = false;
  let geminiMessage = "";
  try {
    createLlmProvider({
      aiProvider: "GEMINI",
      geminiApiKey: "",
      openaiApiKey: "sk-örnek",
      anthropicApiKey: "",
      deepseekApiKey: "",
      grokApiKey: "",
      mistralApiKey: "",
      nvidiaApiKey: "",
      customBaseUrl: "",
      customApiKey: "",
      customModel: "",
      geminiModel: "gemini-2.0-flash",
      openaiModel: "gpt-4o",
      anthropicModel: "claude-sonnet-4-5",
      deepseekModel: "deepseek-chat",
      grokModel: "grok-4",
      mistralModel: "mistral-small-latest",
      nvidiaModel: "moonshotai/kimi-k3",
    });
  } catch (error: unknown) {
    geminiRejected = error instanceof LlmConfigError;
    geminiMessage = errBrief(error);
  }
  assert(geminiRejected, "Gemini key'siz yapılandırma reddedilmedi.");
  assert(
    geminiMessage.includes("Admin panelinden"),
    "Key'siz hata mesajı yönlendirme içermiyor.",
  );
  check("Factory: Gemini key'siz → LlmConfigError", true, geminiMessage);

  let openaiRejected = false;
  try {
    createLlmProvider({
      aiProvider: "OPENAI",
      geminiApiKey: "AIza-örnek",
      openaiApiKey: "   ",
      anthropicApiKey: "",
      deepseekApiKey: "",
      grokApiKey: "",
      mistralApiKey: "",
      nvidiaApiKey: "",
      customBaseUrl: "",
      customApiKey: "",
      customModel: "",
      geminiModel: "gemini-2.0-flash",
      openaiModel: "gpt-4o",
      anthropicModel: "claude-sonnet-4-5",
      deepseekModel: "deepseek-chat",
      grokModel: "grok-4",
      mistralModel: "mistral-small-latest",
      nvidiaModel: "moonshotai/kimi-k3",
    });
  } catch (error: unknown) {
    openaiRejected = error instanceof LlmConfigError;
  }
  assert(openaiRejected, "OpenAI key'siz (boşluklu) yapılandırma reddedilmedi.");
  check("Factory: OpenAI key'siz → LlmConfigError", true, "trim sonrası boş key reddi");

  // ============================================================
  // 4) Prompt kurma — enjeksiyon koruması işaretleri.
  // ============================================================
  const prompt = buildAnalysisDataPrompt({
    symbol: TEST_SYMBOL,
    stockName: "Test Analiz A.Ş.",
    sector: "Doğrulama",
    lastPrice: "10.50",
    priceHistory: [
      { timestamp: new Date("2026-10-01T10:00:00Z"), close: "10.20" },
      { timestamp: new Date("2026-10-02T10:00:00Z"), close: "10.50" },
    ],
    news: [
      {
        title: "Test haberi: şirketten büyük anlaşma",
        summary: "Şirket yeni bir anlaşma imzaladı.",
        publishedAt: new Date("2026-10-02T08:00:00Z"),
        source: "NTV",
      },
    ],
    currentPosition: { quantity: "100", avgCost: "9.80" },
  });
  assert(
    prompt.includes("talimat olarak değerlendirilmez"),
    "Prompt enjeksiyon koruması notu eksik.",
  );
  assert(
    prompt.includes("<<<HİSSE BİLGİSİ") && prompt.includes(">>>"),
    "Veri bloğu sınırlayıcıları eksik.",
  );
  assert(
    prompt.includes(TEST_SYMBOL) && prompt.includes("Test haberi"),
    "Prompt verileri taşımıyor.",
  );
  assert(prompt.includes("100 adet"), "Pozisyon bilgisi prompta taşınmadı.");
  check(
    "buildAnalysisDataPrompt: veri blokları + enjeksiyon koruması",
    true,
    `${prompt.length} karakter, <<< >>> sınırlayıcılar mevcut`,
  );

  // ============================================================
  // 5) Test sembolü + dedup (urlHash unique).
  // ============================================================
  const testStock = await prisma.stock.create({
    data: { symbol: TEST_SYMBOL, name: "Test Analiz A.Ş.", sector: "Doğrulama" },
  });
  testStockId = testStock.id;

  const urlA = "https://ornek.com/haber/dedup-test-1";
  const hashA1 = await hashUrl(urlA);
  const hashA2 = await hashUrl(urlA);
  const hashB = await hashUrl("https://ornek.com/haber/dedup-test-2");
  assert(hashA1 === hashA2, "hashUrl deterministik değil.");
  assert(hashA1 !== hashB, "Farklı URL'ler aynı hash'i üretti.");
  assert(hashA1.length === 64, `hashUrl SHA-256 üretmeli (uzunluk ${hashA1.length}).`);
  check("hashUrl: deterministik SHA-256", true, `${hashA1.slice(0, 12)}… (64 karakter)`);

  await prisma.newsArticle.create({
    data: {
      title: "Dedup test haberi",
      summary: "Aynı URL ikinci kez kaydedilmemeli.",
      url: urlA,
      urlHash: hashA1,
      source: "Test Kaynak",
      publishedAt: new Date(),
      stockId: testStock.id,
    },
  });
  let duplicateRejected = false;
  try {
    await prisma.newsArticle.create({
      data: {
        title: "Dedup test haberi (kopya)",
        summary: "Aynı urlHash — unique ihlali bekleniyor.",
        url: "https://ornek.com/haber/dedup-test-1-kopya",
        urlHash: hashA1,
        source: "Test Kaynak",
        publishedAt: new Date(),
        stockId: testStock.id,
      },
    });
  } catch (error: unknown) {
    duplicateRejected =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002";
  }
  assert(
    duplicateRejected,
    "Aynı urlHash'li ikinci kayıt unique constraint'i ihlal etmedi.",
  );
  const articleCount = await prisma.newsArticle.count({
    where: { stockId: testStock.id },
  });
  assert(articleCount === 1, `Dedup sonrası makale sayısı 1 olmalı (${articleCount}).`);
  check(
    "Dedup: urlHash unique — aynı URL iki kez KAYDEDİLMEZ",
    true,
    "P2002 yakalandı, makale sayısı 1",
  );

  // ============================================================
  // 6) AiAnalysisLog + rate limit (cooldown).
  // ============================================================
  await getOrCreateAdminSettings();
  const settingsRow = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  assert(settingsRow !== null, "AdminSettings kaydı oluşturulamadı.");
  originalCooldownMinutes = settingsRow?.cooldownMinutes ?? 1;
  await prisma.adminSettings.update({
    where: { id: "singleton" },
    data: { cooldownMinutes: 5 },
  });

  // Mock analiz sonucunu AiAnalysisLog'a kaydet (analysis-service deseni).
  const mockAnalysis: ValidatedAiAnalysis = {
    action: "BUY",
    confidence: 0.82,
    reasoning: "Mock doğrulama analizi — al sinyali.",
    risks: ["Regülasyon riski", "Kur oynaklığı"],
  };
  const createdLog = await prisma.aiAnalysisLog.create({
    data: {
      stockId: testStock.id,
      provider: "GEMINI",
      model: "mock-analysis-model",
      action: mockAnalysis.action,
      confidence: new Prisma.Decimal(mockAnalysis.confidence),
      reasoning: mockAnalysis.reasoning,
      risks: JSON.stringify(mockAnalysis.risks),
      rawResponse: JSON.stringify(mockAnalysis),
    },
    include: { stock: { select: { symbol: true } } },
  });
  assert(Boolean(createdLog.id), "AiAnalysisLog kaydı oluşturulamadı.");
  check(
    "AiAnalysisLog: mock analiz kaydı oluşturulur",
    true,
    `id=${createdLog.id.slice(0, 8)}…, action=${createdLog.action}`,
  );

  const listResult = await listAnalysesForStock(TEST_SYMBOL, 1, 10);
  assert(listResult.total === 1, "Analiz geçmişi kayıt sayısı yanlış.");
  const listed = listResult.analyses[0];
  assert(listed?.id === createdLog.id, "listAnalysesForStock kaydı döndürmedi.");
  assert(
    listed?.action === "BUY" && Number(listed?.confidence) === 0.82,
    "Listelenen analiz içeriği bozuk.",
  );
  check(
    "listAnalysesForStock: kayıt geri okunur",
    true,
    `total=${listResult.total}, action=${listed?.action}, confidence=${listed?.confidence}`,
  );

  // Cooldown: yeni kayıt var → izin verilmemeli.
  const cooldown = await checkAnalysisCooldown(testStock.id);
  assert(!cooldown.allowed, "Cooldown aktifken analiz izni verildi.");
  assert(
    cooldown.remainingSeconds > 0 && cooldown.remainingSeconds <= 300,
    `Kalan süre 1-300 sn aralığında olmalı (${cooldown.remainingSeconds}).`,
  );
  check(
    "checkAnalysisCooldown: yeni analiz sonrası reddedilir",
    true,
    `kalan ${cooldown.remainingSeconds} sn (cooldown=${cooldown.cooldownMinutes} dk)`,
  );

  // analyzeStock — cooldown ihlalinde COOLDOWN (429), LLM çağrısına gitmeden.
  let cooldownError: AnalysisServiceError | null = null;
  try {
    await analyzeStock(TEST_SYMBOL);
  } catch (error: unknown) {
    if (error instanceof AnalysisServiceError) cooldownError = error;
  }
  assert(cooldownError !== null, "Cooldown ihlali hata fırlatmadı.");
  assert(
    cooldownError?.code === "COOLDOWN",
    `Hata kodu COOLDOWN olmalı (${cooldownError?.code}).`,
  );
  assert(
    cooldownError?.httpStatus === 429,
    `HTTP durum 429 olmalı (${cooldownError?.httpStatus}).`,
  );
  check(
    "Rate limit: analyzeStock cooldown'da 429 fırlatır",
    true,
    "LLM çağrısına gitmeden reddedildi",
  );

  // MISSING_API_KEY — key yoksa (key varsa atla: gerçek LLM çağrısı önlenir).
  const config = await getLlmProviderConfig();
  // Sağlayıcıya göre doğru key alanını çözümle. CUSTOM (Local AI) key
  // opsiyonel olduğundan ve gerçek ağ çağrısı önlenmek istediğinden bu
  // senaryo CUSTOM'ta atlanır (Ollama kapalıyken PROVIDER_ERROR üretirdi).
  const providerKeyMap: Record<string, string> = {
    GEMINI: config.geminiApiKey.trim(),
    OPENAI: config.openaiApiKey.trim(),
    ANTHROPIC: config.anthropicApiKey.trim(),
    DEEPSEEK: config.deepseekApiKey.trim(),
    GROK: config.grokApiKey.trim(),
    MISTRAL: config.mistralApiKey.trim(),
    CUSTOM: config.customApiKey.trim(),
  };
  const activeKey = providerKeyMap[config.aiProvider] ?? "";
  const isLocalProvider = config.aiProvider === "CUSTOM";
  if (!activeKey && !isLocalProvider) {
    let keyError: AnalysisServiceError | null = null;
    try {
      await analyzeStock(TEST_SYMBOL, { skipCooldown: true });
    } catch (error: unknown) {
      if (error instanceof AnalysisServiceError) keyError = error;
    }
    assert(keyError !== null, "Key'siz analiz denemesi hata fırlatmadı.");
    assert(
      keyError?.code === "MISSING_API_KEY",
      `Hata kodu MISSING_API_KEY olmalı (${keyError?.code}).`,
    );
    assert(
      keyError?.httpStatus === 400,
      `HTTP durum 400 olmalı (${keyError?.httpStatus}).`,
    );
    check(
      "MISSING_API_KEY: key'siz analiz 400 reddedilir",
      true,
      keyError?.message.slice(0, 60) ?? "",
    );
  } else {
    check(
      "MISSING_API_KEY: key'siz analiz 400 reddedilir",
      true,
      `atlandı — ${config.aiProvider} key tanımlı, gereksiz gerçek LLM çağrısı önleniyor`,
    );
  }

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
    await cleanup();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("\n✗ Script hata ile sonlandı:", errBrief(error));
    await cleanup();
    process.exit(1);
  });
