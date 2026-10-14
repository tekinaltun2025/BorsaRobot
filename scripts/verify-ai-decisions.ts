/**
 * AI Kararları servisi doğrulama — izole test verisiyle.
 * Kullanım: npx tsx scripts/verify-ai-decisions.ts (veya npm run verify:ai-decisions)
 *
 * Doğrulanan akışlar:
 *  1. AiDecisionLog create → listDecisions sıralama (en yeniden eskiye).
 *  2. listDecisions sembol filtresi.
 *  3. listDecisions eylem filtresi.
 *  4. listDecisions cursor sayfalama (hasMore + nextCursor + ikinci sayfa).
 *  5. askDecisionQuestion — mock LLM provider ile: soru + yanıt kalıcı
 *     kaydedilir, bağlam karar sayısı doğru iletilir.
 *  6. askDecisionQuestion — boş soru reddedilir (VALIDATION).
 *  7. listChatMessages — geçmiş en yeniden eskiye döner.
 *  8. Temizlik: test verisi silinir, kullanıcı verisine dokunulmaz.
 *
 * İzolasyon: AIDECTST* sembolleri ve mock provider ile çalışır; gerçek LLM
 * çağrısı YAPILMAZ (ağ gerektirmez). Kullanıcının gerçek karar kayıtlarına
 * ve sohbetine dokunulmaz — yalnızca test kayıtları silinir.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  listDecisions,
  askDecisionQuestion,
  listChatMessages,
  AiDecisionServiceError,
} from "../src/server/services/ai-decision-service";
import type { ILlmProvider } from "../src/server/providers/llm-provider";
import type { AiProvider } from "../src/lib/types";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-pnl.ts deseni. */
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name} — ${detail}`);
  } else {
    failed += 1;
    console.error(`✗ ${name} — ${detail}`);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

/** Hatayı kısa tanımlar (log okunabilirliği). */
function errBrief(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mock LLM provider — yalnızca bu script'te tanımlı (verify-auto-trade.ts
 * deseni). Sorunun bağlam bloğunu yakalayıp sabit yanıt döndürür.
 */
class MockLlmProvider implements ILlmProvider {
  readonly providerId: AiProvider = "NVIDIA";
  readonly model = "mock-decision-model";
  /** Son çağrıda alınan prompt (bağlam teyidi için). */
  lastPrompt: string | null = null;
  lastSystemPrompt: string | null = null;

  async generateStructured(
    prompt: string,
    systemPrompt: string,
  ): Promise<string> {
    this.lastPrompt = prompt;
    this.lastSystemPrompt = systemPrompt;
    // Gerçek sağlayıcı gibi küçük bir gecikme: ASSISTANT kaydının
    // createdAt'i USER sorusundan kesinlikle sonra yazılsın (deterministik sıra).
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "Mock yanıt: Test kararı bağlamı doğru şekilde iletildi.";
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock sağlayıcı: bağlantı her zaman başarılı." };
  }
}

/** İzole test sembolleri — kullanıcı verisiyle çakışmaz. */
const TEST_SYMBOLS = ["AIDECTST1", "AIDECTST2", "AIDECTST3"] as const;

/** Temizlik: yalnızca bu script'in ürettiği kayıtları siler. */
async function cleanup(): Promise<void> {
  try {
    await prisma.aiDecisionLog.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });
    // Sohbet temizliği: mock yanıt içeriğiyle eşleşen test kayıtları.
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { contains: "Mock yanıt:" } },
    });
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { startsWith: "VERIFY-AIDEC sorusu" } },
    });
    await prisma.stock.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });
    console.log("\nTemizlik: test karar/sohbet kayıtları silindi.");
  } catch (error: unknown) {
    console.error("Temizlik sırasında hata:", errBrief(error));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("=== AI KARARLARI SERVİSİ DOĞRULAMA ===\n");

  // --- Kullanıcı verisini koru: mevcut kayıt sayıları.
  const userDecisionCount = await prisma.aiDecisionLog.count();
  const userChatCount = await prisma.aiDecisionChat.count();

  // --- İzole test hisseleri (relation bağlantısı için).
  const stocks = await Promise.all(
    TEST_SYMBOLS.map((symbol, i) =>
      prisma.stock.upsert({
        where: { symbol },
        update: {},
        create: {
          symbol,
          name: `AI Karar Test Hisse ${i + 1}`,
          lastPrice: new Prisma.Decimal(100 + i * 10),
          isActive: false,
        },
      }),
    ),
  );
  const stockIdBySymbol: Record<string, string> = {};
  for (const stock of stocks) {
    stockIdBySymbol[stock.symbol] = stock.id;
  }

  // --- Test kararları: zaman damgaları sıralamayı belirler (eski → yeni).
  const now = Date.now();
  const testDecisionIds: string[] = [];
  const decisionDefs: {
    symbol: string;
    action: "BUY" | "SELL" | "HOLD" | "SKIP";
    reasoning: string;
    research: string;
    innerMonologue: string | null;
    confidence: number;
    orderPlaced: boolean;
    quantity: string | null;
    price: string | null;
    skipReason: string | null;
    minutesAgo: number;
  }[] = [
    {
      symbol: "AIDECTST1",
      action: "BUY",
      reasoning: "Güçlü yükseliş trendi ve olumlu haber akışı — alım.",
      research: "Son fiyat 100 TL; son 5 kapanış artışta; haberler olumlu.",
      innerMonologue: "Fiyat hareketi destek seviyesini test etti, momentum güçlü.",
      confidence: 85,
      orderPlaced: true,
      quantity: "150",
      price: "100",
      skipReason: null,
      minutesAgo: 50,
    },
    {
      symbol: "AIDECTST2",
      action: "SELL",
      reasoning: "Take-profit eşiği aşıldı — kâr realizasyonu.",
      research: "Ortalama maliyet 90 TL; güncel fiyat 120 TL (+%33).",
      innerMonologue: null,
      confidence: 92,
      orderPlaced: true,
      quantity: "200",
      price: "120",
      skipReason: null,
      minutesAgo: 30,
    },
    {
      symbol: "AIDECTST3",
      action: "HOLD",
      reasoning: "Kararsız yatay seyir — beklemede kal.",
      research: "Son fiyat 120 TL; trend yatay; hacim düşük.",
      innerMonologue: null,
      confidence: 55,
      orderPlaced: false,
      quantity: null,
      price: null,
      skipReason: null,
      minutesAgo: 10,
    },
    {
      symbol: "AIDECTST1",
      action: "SKIP",
      reasoning: "Alım sinyali geldi ancak güven eşiğin altında.",
      research: "Son fiyat 105 TL; sinyal zayıf.",
      innerMonologue: null,
      confidence: 40,
      orderPlaced: false,
      quantity: null,
      price: null,
      skipReason: "Güven skoru 0.40 < eşik 0.70 — emir üretilmedi.",
      minutesAgo: 5,
    },
  ];

  for (const def of decisionDefs) {
    const row = await prisma.aiDecisionLog.create({
      data: {
        jobRunId: `verify-aidec-jobrun-${crypto.randomUUID()}`,
        symbol: def.symbol,
        action: def.action,
        research: def.research,
        reasoning: def.reasoning,
        innerMonologue: def.innerMonologue,
        confidence: def.confidence,
        orderPlaced: def.orderPlaced,
        quantity: def.quantity !== null ? new Prisma.Decimal(def.quantity) : null,
        price: def.price !== null ? new Prisma.Decimal(def.price) : null,
        skipReason: def.skipReason,
        model: "mock-decision-model",
        provider: "NVIDIA",
        latencyMs: 1234,
        stockId: stockIdBySymbol[def.symbol] ?? null,
        createdAt: new Date(now - def.minutesAgo * 60 * 1000),
      },
    });
    testDecisionIds.push(row.id);
  }

  try {
    // ============================================================
    // 1) listDecisions: en yeniden eskiye sıralama.
    // ============================================================
    const firstPage = await listDecisions({ limit: 20 });
    const testRows = firstPage.decisions.filter((d) =>
      TEST_SYMBOLS.includes(d.symbol as (typeof TEST_SYMBOLS)[number]),
    );
    check(
      "listDecisions: test kayıtları listelenir",
      testRows.length === 4,
      `${testRows.length}/4 kayıt göründü`,
    );
    const newestFirst = testRows.map((d) => d.createdAt);
    const sorted = [...newestFirst].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    check(
      "listDecisions: en yeniden eskiye sıralı",
      newestFirst.length === 4 &&
        newestFirst.every((v, i) => v === sorted[i]),
      `sıra=${newestFirst.map((c) => c.slice(11, 16)).join(", ")}`,
    );

    // Alan eşlemesi: Decimal → string, action, confidence.
    const buyRow = testRows.find((d) => d.action === "BUY");
    check(
      "Karar görünümü alanları doğru",
      buyRow !== undefined &&
        buyRow.quantity === "150" &&
        buyRow.price === "100" &&
        buyRow.confidence === 85 &&
        buyRow.orderPlaced === true &&
        buyRow.innerMonologue !== null &&
        buyRow.provider === "NVIDIA" &&
        buyRow.latencyMs === 1234,
      `BUY: quantity=${buyRow?.quantity}, price=${buyRow?.price}, güven=${buyRow?.confidence}`,
    );

    // ============================================================
    // 2) Sembol filtresi.
    // ============================================================
    const symbolFiltered = await listDecisions({
      limit: 20,
      symbol: "AIDECTST1",
    });
    check(
      "listDecisions: sembol filtresi",
      symbolFiltered.decisions.length === 2 &&
        symbolFiltered.decisions.every((d) => d.symbol === "AIDECTST1"),
      `AIDECTST1 kayıt sayısı=${symbolFiltered.decisions.length} (beklenen 2)`,
    );

    // ============================================================
    // 3) Eylem filtresi.
    // ============================================================
    const actionFiltered = await listDecisions({
      limit: 20,
      action: "SKIP",
    });
    const testSkips = actionFiltered.decisions.filter((d) =>
      TEST_SYMBOLS.includes(d.symbol as (typeof TEST_SYMBOLS)[number]),
    );
    check(
      "listDecisions: eylem filtresi (SKIP)",
      testSkips.length === 1 &&
        testSkips[0]?.skipReason !== null &&
        testSkips[0]?.skipReason.includes("eşik") === true,
      `SKIP kaydı=${testSkips.length}, neden="${testSkips[0]?.skipReason?.slice(0, 40) ?? "?"}…"`,
    );

    // ============================================================
    // 4) Cursor sayfalama: limit=2 → hasMore + ikinci sayfa.
    // ============================================================
    const page1 = await listDecisions({ limit: 2 });
    assert(page1.hasMore === true, "İlk sayfada hasMore=true olmalı.");
    assert(page1.nextCursor !== null, "nextCursor dolu olmalı.");
    const page2 = await listDecisions({
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    const page1Ids = new Set(page1.decisions.map((d) => d.id));
    const overlap = page2.decisions.filter((d) => page1Ids.has(d.id));
    check(
      "listDecisions: cursor sayfalama",
      page1.decisions.length === 2 &&
        page2.decisions.length === 2 &&
        overlap.length === 0,
      `sayfa1=2, sayfa2=2, çakışma=${overlap.length}`,
    );

    // ============================================================
    // 5) askDecisionQuestion — mock provider ile.
    // ============================================================
    const mock = new MockLlmProvider();
    const askResult = await askDecisionQuestion(
      "VERIFY-AIDEC sorusu: AIDECTST1'i neden aldın?",
      10,
      { llmProvider: mock },
    );
    check(
      "askDecisionQuestion: soru + yanıt kalıcı kaydedilir",
      askResult.question.role === "USER" &&
        askResult.question.content.includes("AIDECTST1") &&
        askResult.answer.role === "ASSISTANT" &&
        askResult.answer.content.includes("Mock yanıt") &&
        askResult.answer.provider === "NVIDIA" &&
        askResult.answer.model === "mock-decision-model",
      `soru id=${askResult.question.id.slice(0, 8)}…, yanıt="${askResult.answer.content.slice(0, 30)}…"`,
    );

    // Bağlam teyidi: sistem promptu karar özetini içermeli.
    const systemPrompt = mock.lastSystemPrompt ?? "";
    check(
      "askDecisionQuestion: karar bağlamı prompt'a taşınır",
      systemPrompt.includes("AIDECTST1") &&
        systemPrompt.includes("BUY") &&
        systemPrompt.includes("Güçlü yükseliş trendi") &&
        systemPrompt.includes("<<<SON KARARLARIN"),
      `bağlam uzunluğu=${systemPrompt.length}, AIDECTST1 geçiyor=${systemPrompt.includes("AIDECTST1")}`,
    );
    check(
      "askDecisionQuestion: bağlam karar sayısı doğru",
      askResult.contextCount === 4,
      `bağlam=${askResult.contextCount} karar (beklenen 4)`,
    );

    // ============================================================
    // 6) Boş/aşırı kısa soru reddedilir.
    // ============================================================
    let validationCaught = false;
    try {
      await askDecisionQuestion("  ", 10, { llmProvider: mock });
    } catch (error: unknown) {
      validationCaught =
        error instanceof AiDecisionServiceError && error.code === "VALIDATION";
    }
    check(
      "askDecisionQuestion: boş soru VALIDATION ile reddedilir",
      validationCaught,
      validationCaught ? "422 VALIDATION fırlatıldı" : "hata YAKALANAMADI",
    );

    // ============================================================
    // 7) listChatMessages — geçmiş en yeniden eskiye.
    // ============================================================
    const chatHistory = await listChatMessages(100);
    const testChat = chatHistory.filter(
      (m) =>
        m.content.includes("VERIFY-AIDEC") || m.content.includes("Mock yanıt:"),
    );
    check(
      "listChatMessages: sohbet geçmişi kalıcı ve sıralı",
      testChat.length === 2 &&
        testChat[0]?.role === "ASSISTANT" &&
        testChat[1]?.role === "USER" &&
        testChat[0].createdAt >= testChat[1].createdAt,
      `${testChat.length} mesaj (ASSISTANT→USER, yeni→eski)`,
    );

    // ============================================================
    // 8) Temizlik + kullanıcı verisi korundu kanıtı.
    // ============================================================
    await prisma.aiDecisionLog.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { contains: "Mock yanıt:" } },
    });
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { startsWith: "VERIFY-AIDEC sorusu" } },
    });
    await prisma.stock.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });

    const finalDecisionCount = await prisma.aiDecisionLog.count();
    const finalChatCount = await prisma.aiDecisionChat.count();
    check(
      "Temizlik: kullanıcı verileri korundu",
      finalDecisionCount === userDecisionCount &&
        finalChatCount === userChatCount,
      `karar=${finalDecisionCount}/${userDecisionCount}, sohbet=${finalChatCount}/${userChatCount}`,
    );
  } finally {
    // finally bloğunda tekrar temizlik — assert fırlatılsa da iz bırakmaz.
    await prisma.aiDecisionLog.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { contains: "Mock yanıt:" } },
    });
    await prisma.aiDecisionChat.deleteMany({
      where: { content: { startsWith: "VERIFY-AIDEC sorusu" } },
    });
    await prisma.stock.deleteMany({
      where: { symbol: { in: [...TEST_SYMBOLS] } },
    });
  }

  console.log(`\n--- ÖZET ---`);
  console.log(`${passed}/${passed + failed} doğrulama başarılı.`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch(async (error: unknown) => {
  console.error("Beklenmeyen hata:", errBrief(error));
  process.exitCode = 1;
  await cleanup();
});
