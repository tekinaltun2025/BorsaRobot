/**
 * AI sağlayıcı genişletmesi doğrulama scripti — 8 sağlayıcı + Local AI (Custom).
 *
 * Kullanım: npx tsx scripts/verify-ai-providers.ts  (veya npm run verify:ai-providers)
 *
 * API key GEREKMEZ: gerçek LLM çağrıları yapılmaz; factory üretimi mock
 * key'lerle test edilir. OpenAI-compatible provider'ın farklı base URL'lerle
 * çalışması yerel mock HTTP sunucusuyla doğrulanır (Ollama varsa gerçek
 * canlı test de yapılır).
 *
 * Doğrulanan akışlar:
 *  1. Factory: 8 sağlayıcının tamamı doğru provider sınıfını üretir (mock key).
 *  2. Factory: CUSTOM base URL'siz → LlmConfigError ("Base URL girin").
 *  3. Factory: CUSTOM model'siz → LlmConfigError ("model adı girin").
 *  4. Factory: bulut sağlayıcılarda key'siz → LlmConfigError.
 *  5. Validator: aiProvider enum 8 değer; CUSTOM + boş customBaseUrl reddi.
 *  6. Validator: CUSTOM + geçerli base URL kabul; hatalı URL formatı reddi.
 *  7. Maskeli görünüm: customApiKey son 4 karakter; plain key sızmaz.
 *  8. OpenAI-compatible: mock HTTP sunucusuyla gerçek chat/completions çağrısı
 *     (key'siz local senaryo — Authorization header'ı eklenmez).
 *  9. OpenAI-compatible: 401 yanıtı → INVALID_API_KEY sınıflandırması.
 * 10. NVIDIA: reasoning_effort="max" istek gövdesine eklenir; NVIDIA dışı
 *     sağlayıcılarda (CUSTOM) reasoning_effort gönderilmez.
 * 11. Ollama canlı test (varsa): http://localhost:11434/v1 ile gerçek ping.
 * 12. NVIDIA NIM canlı test (NVIDIA_API_KEY varsa): gerçek Kimi K3 ping —
 *     ağ erişimi yoksa graceful atlanır.
 */
import { PrismaClient } from "@prisma/client";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  LlmConfigError,
  type ILlmProvider,
} from "../src/server/providers/llm-provider";
import {
  createLlmProvider,
  type LlmProviderConfig,
} from "../src/server/providers/llm-provider-factory";
import {
  OpenAiCompatibleLlmProvider,
} from "../src/server/providers/openai-compatible-provider";
import { adminSettingsUpdateSchema } from "../src/lib/validators/admin-settings";
import { maskApiKey } from "../src/lib/utils";
import { PROVIDER_INFO, getModelsForProvider } from "../src/lib/constants";
import type { AiProvider } from "../src/lib/types";

const prisma = new PrismaClient();

/** Test sonucu toplayıcı — verify-ai.ts deseni. */
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

/** Mock logApiCall — ApiCallLog'a yazmaz, çağrı sayısını sayar. */
let logCallCount = 0;
const mockLogApiCall = async (): Promise<void> => {
  logCallCount += 1;
};

/** Tam LlmProviderConfig üretir — verilen alanları override eder. */
function makeConfig(overrides: Partial<LlmProviderConfig>): LlmProviderConfig {
  return {
    aiProvider: "GEMINI",
    geminiApiKey: "",
    openaiApiKey: "",
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
    ...overrides,
  };
}

/** Mock OpenAI-uyumlu HTTP sunucusu — /v1/chat/completions yanıtları. */
function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}`;
      resolve({
        server,
        url,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

/** Ollama kurulu mu? (GET /api/tags — 2 sn timeout) */
async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch("http://localhost:11434/api/tags", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("=== AI SAĞLAYICI GENİŞLETMESİ DOĞRULAMA (8 sağlayıcı + Local AI) ===\n");

  // ============================================================
  // 1) Factory — 8 sağlayıcı üretimi (mock key'lerle).
  // ============================================================
  const factoryCases: {
    provider: AiProvider;
    expectedClass: string;
    keyField: keyof LlmProviderConfig;
    modelField: keyof LlmProviderConfig;
  }[] = [
    { provider: "GEMINI", expectedClass: "GeminiLlmProvider", keyField: "geminiApiKey", modelField: "geminiModel" },
    { provider: "OPENAI", expectedClass: "OpenAiLlmProvider", keyField: "openaiApiKey", modelField: "openaiModel" },
    { provider: "ANTHROPIC", expectedClass: "AnthropicLlmProvider", keyField: "anthropicApiKey", modelField: "anthropicModel" },
    { provider: "DEEPSEEK", expectedClass: "OpenAiCompatibleLlmProvider", keyField: "deepseekApiKey", modelField: "deepseekModel" },
    { provider: "GROK", expectedClass: "OpenAiCompatibleLlmProvider", keyField: "grokApiKey", modelField: "grokModel" },
    { provider: "MISTRAL", expectedClass: "OpenAiCompatibleLlmProvider", keyField: "mistralApiKey", modelField: "mistralModel" },
    { provider: "NVIDIA", expectedClass: "OpenAiCompatibleLlmProvider", keyField: "nvidiaApiKey", modelField: "nvidiaModel" },
  ];

  for (const testCase of factoryCases) {
    const provider = createLlmProvider(
      makeConfig({
        aiProvider: testCase.provider,
        [testCase.keyField]: "mock-key-1234",
      }),
    );
    assert(
      provider.constructor.name === testCase.expectedClass,
      `${testCase.provider} için beklenen sınıf ${testCase.expectedClass} (${provider.constructor.name}).`,
    );
    assert(
      provider.providerId === testCase.provider,
      `providerId beklenen değer değil (${provider.providerId}).`,
    );
    check(
      `Factory: ${testCase.provider} → ${testCase.expectedClass}`,
      true,
      `providerId=${provider.providerId}, model=${provider.model}`,
    );
  }

  // CUSTOM — base URL + model ile üretim.
  const customProvider = createLlmProvider(
    makeConfig({
      aiProvider: "CUSTOM",
      customBaseUrl: "http://localhost:11434/v1",
      customModel: "llama3.2",
    }),
  );
  assert(
    customProvider.constructor.name === "OpenAiCompatibleLlmProvider",
    "CUSTOM için OpenAiCompatibleLlmProvider üretilmedi.",
  );
  assert(customProvider.providerId === "CUSTOM", "CUSTOM providerId yanlış.");
  assert(customProvider.model === "llama3.2", "CUSTOM model taşınmadı.");
  check(
    "Factory: CUSTOM (base URL + model) → OpenAiCompatibleLlmProvider",
    true,
    `model=${customProvider.model}`,
  );

  // ============================================================
  // 2) Factory — CUSTOM base URL'siz red.
  // ============================================================
  let customNoUrlRejected = false;
  let customNoUrlMessage = "";
  try {
    createLlmProvider(makeConfig({ aiProvider: "CUSTOM", customBaseUrl: "", customModel: "llama3.2" }));
  } catch (error: unknown) {
    customNoUrlRejected = error instanceof LlmConfigError;
    customNoUrlMessage = errBrief(error);
  }
  assert(customNoUrlRejected, "CUSTOM base URL'siz reddedilmedi.");
  assert(
    customNoUrlMessage.includes("Base URL"),
    "CUSTOM base URL hata mesajı 'Base URL' içermiyor.",
  );
  check("Factory: CUSTOM base URL'siz → LlmConfigError", true, customNoUrlMessage.slice(0, 70));

  // ============================================================
  // 3) Factory — CUSTOM model'siz red.
  // ============================================================
  let customNoModelRejected = false;
  let customNoModelMessage = "";
  try {
    createLlmProvider(
      makeConfig({ aiProvider: "CUSTOM", customBaseUrl: "http://localhost:11434/v1", customModel: "" }),
    );
  } catch (error: unknown) {
    customNoModelRejected = error instanceof LlmConfigError;
    customNoModelMessage = errBrief(error);
  }
  assert(customNoModelRejected, "CUSTOM model'siz reddedilmedi.");
  assert(
    customNoModelMessage.includes("model adı"),
    "CUSTOM model hata mesajı 'model adı' içermiyor.",
  );
  check("Factory: CUSTOM model'siz → LlmConfigError", true, customNoModelMessage.slice(0, 70));

  // ============================================================
  // 4) Factory — bulut sağlayıcılarda key'siz red.
  // ============================================================
  for (const testCase of factoryCases) {
    let rejected = false;
    try {
      createLlmProvider(makeConfig({ aiProvider: testCase.provider }));
    } catch (error: unknown) {
      rejected = error instanceof LlmConfigError;
    }
    assert(rejected, `${testCase.provider} key'siz reddedilmedi.`);
  }
  check(
    "Factory: 7 bulut sağlayıcı key'siz → LlmConfigError",
    true,
    "GEMINI/OPENAI/ANTHROPIC/DEEPSEEK/GROK/MISTRAL/NVIDIA",
  );

  // ============================================================
  // 5) Validator — enum 8 değer + CUSTOM boş base URL reddi.
  // ============================================================
  const allProviders: AiProvider[] = ["GEMINI", "OPENAI", "ANTHROPIC", "DEEPSEEK", "GROK", "MISTRAL", "NVIDIA", "CUSTOM"];
  for (const p of allProviders) {
    const parsed = adminSettingsUpdateSchema.safeParse({ aiProvider: p });
    assert(parsed.success, `aiProvider=${p} enum tarafından kabul edilmedi.`);
  }
  check("Validator: aiProvider enum 8 değer kabul", true, allProviders.join("/"));

  let customEmptyUrlRejected = false;
  const emptyUrlParse = adminSettingsUpdateSchema.safeParse({
    aiProvider: "CUSTOM",
    customBaseUrl: "",
  });
  customEmptyUrlRejected = !emptyUrlParse.success;
  assert(customEmptyUrlRejected, "CUSTOM + boş customBaseUrl reddedilmedi.");
  const emptyUrlErrors = emptyUrlParse.success ? [] : emptyUrlParse.error.flatten().fieldErrors.customBaseUrl ?? [];
  assert(
    emptyUrlErrors.some((m) => m.includes("Base URL")),
    "Boş base URL hata mesajı 'Base URL' içermiyor.",
  );
  check("Validator: CUSTOM + boş customBaseUrl reddedilir", true, emptyUrlErrors[0] ?? "");

  // ============================================================
  // 6) Validator — geçerli base URL kabul + hatalı format reddi.
  // ============================================================
  const validUrlParse = adminSettingsUpdateSchema.safeParse({
    aiProvider: "CUSTOM",
    customBaseUrl: "http://localhost:11434/v1",
    customModel: "llama3.2",
    customApiKey: "",
  });
  assert(validUrlParse.success, "Geçerli CUSTOM yapılandırması reddedildi.");
  check("Validator: CUSTOM + geçerli base URL kabul", true, "http://localhost:11434/v1 + llama3.2");

  const badUrlParse = adminSettingsUpdateSchema.safeParse({
    customBaseUrl: "localhost:11434/v1",
  });
  assert(!badUrlParse.success, "http/https şemasız URL reddedilmedi.");
  check("Validator: http/https şemasız URL reddedilir", true, "localhost:11434/v1 → hata");

  // ============================================================
  // 7) Maskeli görünüm — customApiKey son 4 karakter.
  // ============================================================
  const masked = maskApiKey("lm-studio-secret-9876");
  assert(masked.endsWith("9876"), `Maskeli key son 4 karakteri göstermeli (${masked}).`);
  assert(!masked.includes("secret"), "Maskeli key düz metin sızdırıyor.");
  const emptyMasked = maskApiKey("");
  assert(emptyMasked === "", "Boş key maskeli görünümde boş dönmeli.");
  check("Maskeli görünüm: customApiKey son 4 karakter", true, `••••••••9876 (plain sızmadı)`);

  // ============================================================
  // 8) OpenAI-compatible — mock sunucu ile key'siz local senaryo.
  // ============================================================
  const mockServer1 = await startMockServer((req, res, body) => {
    const authHeader = req.headers.authorization ?? "";
    const parsedBody = JSON.parse(body) as { model?: string; messages?: { role: string }[] };
    // Key'siz local senaryo: Authorization header'ı GÖNDERİLMEMELİ.
    const hasBearer = authHeader.startsWith("Bearer ") && authHeader.length > 7;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: hasBearer ? '{"reply":"BEARER-LEAKED"}' : '{"reply":"PONG"}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        _echoModel: parsedBody.model ?? "",
      }),
    );
  });

  const localProvider = new OpenAiCompatibleLlmProvider({
    providerId: "CUSTOM",
    baseUrl: mockServer1.url,
    apiKey: "",
    model: "llama3.2",
    logApiCall: mockLogApiCall,
  });
  const localReply = await localProvider.generateStructured("ping", "test system");
  assert(
    localReply.includes("PONG") && !localReply.includes("BEARER-LEAKED"),
    `Key'siz local çağrıda Authorization header sızdı veya yanıt bozuk (${localReply}).`,
  );
  assert(logCallCount >= 1, "ApiCallLog enjeksiyonu çağrılmadı.");
  check(
    "OpenAI-compatible: key'siz local çağrı — Authorization eklenmez",
    true,
    `yanıt=${localReply.slice(0, 30)}, logCall=${logCallCount}`,
  );

  // Model adının istek gövdesine taşındığını doğrula (ikinci çağrı).
  // Ayrıca NVIDIA dışı sağlayıcıda (CUSTOM) reasoning_effort GÖNDERİLMEMELİDİR.
  let echoedModel = "";
  let customEffortSent: string | null = null;
  const mockServer2 = await startMockServer((_req, res, body) => {
    const parsedBody = JSON.parse(body) as { model?: string; reasoning_effort?: string };
    echoedModel = parsedBody.model ?? "";
    customEffortSent = typeof parsedBody.reasoning_effort === "string" ? parsedBody.reasoning_effort : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: '{"reply":"PONG"}' }, finish_reason: "stop" }],
      }),
    );
  });
  const qwenProvider = new OpenAiCompatibleLlmProvider({
    providerId: "CUSTOM",
    baseUrl: mockServer2.url,
    apiKey: "",
    model: "qwen2.5",
    logApiCall: mockLogApiCall,
  });
  await qwenProvider.generateStructured("ping", "test system");
  assert(echoedModel === "qwen2.5", `Model adı istek gövdesine taşınmadı (${echoedModel}).`);
  assert(customEffortSent === null, `CUSTOM isteginde reasoning_effort gönderilmemeli (${customEffortSent}).`);
  check(
    "OpenAI-compatible: model adı istek gövdesine taşınır",
    true,
    `model=${echoedModel}, reasoning_effort gönderilmedi (CUSTOM)`,
  );

  // ============================================================
  // 9) OpenAI-compatible — 401 → INVALID_API_KEY sınıflandırması.
  // ============================================================
  const mockServer3 = await startMockServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API key", type: "invalid_request_error" } }));
  });
  const unauthorizedProvider = new OpenAiCompatibleLlmProvider({
    providerId: "DEEPSEEK",
    baseUrl: mockServer3.url,
    apiKey: "wrong-key",
    model: "deepseek-chat",
    logApiCall: mockLogApiCall,
  });
  let unauthorizedCode = "";
  try {
    await unauthorizedProvider.generateStructured("ping", "test system");
  } catch (error: unknown) {
    const shape = error as { code?: string };
    unauthorizedCode = typeof shape?.code === "string" ? shape.code : "";
  }
  assert(unauthorizedCode === "INVALID_API_KEY", `401 yanıtı INVALID_API_KEY'e map edilmedi (${unauthorizedCode}).`);
  check("OpenAI-compatible: 401 → INVALID_API_KEY", true, "DeepSeek mock 401 yanıtı");

  // ============================================================
  // 9.5) NVIDIA — reasoning_effort="max" istek gövdesine eklenir.
  // ============================================================
  let nvidiaEffort = "";
  let nvidiaAuth = "";
  const mockServer4 = await startMockServer((req, res, body) => {
    const parsedBody = JSON.parse(body) as { model?: string; reasoning_effort?: string };
    nvidiaEffort = parsedBody.reasoning_effort ?? "";
    nvidiaAuth = req.headers.authorization ?? "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: '{"reply":"PONG"}' }, finish_reason: "stop" }],
      }),
    );
  });
  const nvidiaMockProvider = new OpenAiCompatibleLlmProvider({
    providerId: "NVIDIA",
    baseUrl: mockServer4.url,
    apiKey: "mock-nvapi-1234",
    model: "moonshotai/kimi-k3",
    reasoningEffort: "max",
    logApiCall: mockLogApiCall,
  });
  await nvidiaMockProvider.generateStructured("ping", "test system");
  assert(nvidiaEffort === "max", `NVIDIA isteginde reasoning_effort="max" olmalı (${nvidiaEffort}).`);
  assert(
    nvidiaAuth === "Bearer mock-nvapi-1234",
    `NVIDIA Bearer key gönderilmedi (${nvidiaAuth}).`,
  );
  check(
    "NVIDIA: reasoning_effort=max istek gövdesine eklenir",
    true,
    `effort=${nvidiaEffort}, Bearer key gönderildi`,
  );
  await mockServer4.close();

  // ============================================================
  // 10) Ollama canlı test (varsa).
  // ============================================================
  const ollamaRunning = await isOllamaRunning();
  if (ollamaRunning) {
    // Kurulu ilk modeli çek.
    let firstModel = "";
    try {
      const tagsResponse = await fetch("http://localhost:11434/api/tags");
      const tags = (await tagsResponse.json()) as { models?: { name?: string }[] };
      firstModel = tags.models?.[0]?.name ?? "";
    } catch {
      firstModel = "";
    }
    if (firstModel) {
      const ollamaProvider = new OpenAiCompatibleLlmProvider({
        providerId: "CUSTOM",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "",
        model: firstModel,
        logApiCall: mockLogApiCall,
      });
      const testResult = await ollamaProvider.testConnection();
      check(
        "Ollama canlı test: CUSTOM sağlayıcı gerçek ping",
        testResult.ok,
        `${firstModel} @ http://localhost:11434/v1 — ${testResult.message.slice(0, 60)}`,
      );
      assert(testResult.ok, `Ollama canlı test başarısız: ${testResult.message}`);
    } else {
      check(
        "Ollama canlı test: atlandı",
        true,
        "Ollama çalışıyor ama kurulu model yok (ollama pull ile model indirin).",
      );
    }
  } else {
    check(
      "Ollama canlı test: atlandı",
      true,
      "Ollama kurulu değil (http://localhost:11434 yanıt vermedi) — mock testler kapsıyor.",
    );
  }

  // ============================================================
  // 10.5) NVIDIA NIM canlı test (NVIDIA_API_KEY tanımlıysa).
  // ============================================================
  const nvidiaRealKey = process.env.NVIDIA_API_KEY?.trim() ?? "";
  if (nvidiaRealKey) {
    try {
      const nvidiaRealProvider = new OpenAiCompatibleLlmProvider({
        providerId: "NVIDIA",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: nvidiaRealKey,
        model: "moonshotai/kimi-k3",
        reasoningEffort: "max",
        logApiCall: mockLogApiCall,
      });
      const nvidiaRealResult = await nvidiaRealProvider.testConnection();
      // Timeout/ağ koşulları servis sağlığıyla ilgili değildir (dış dünya
      // gecikmesi); hard-fail yerine "atlandı" muafiyetine yönlendirilir —
      // catch bloğundaki desenle aynı politika.
      const transientFailure =
        /yanıtlanmadı|timeout|TIMEOUT|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|aborted|UND_ERR/i.test(
          nvidiaRealResult.message,
        );
      check(
        transientFailure
          ? "NVIDIA canlı test: atlandı (dış servis yanıt vermedi)"
          : "NVIDIA canlı test: Kimi K3 gerçek ping",
        transientFailure || nvidiaRealResult.ok,
        nvidiaRealResult.message.slice(0, 80),
      );
    } catch (error: unknown) {
      const message = errBrief(error);
      const networkIssue =
        /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|aborted|TIMEOUT|UND_ERR/i.test(message);
      if (networkIssue) {
        check("NVIDIA canlı test: atlandı (ağ erişimi yok)", true, message.slice(0, 80));
      } else {
        check("NVIDIA canlı test: başarısız", false, message.slice(0, 80));
      }
    }
  } else {
    check(
      "NVIDIA canlı test: atlandı",
      true,
      "NVIDIA_API_KEY tanımlı değil (.env) — mock testler kapsıyor.",
    );
  }

  // ============================================================
  // 11) PROVIDER_INFO + model listeleri tutarlılığı.
  // ============================================================
  assert(PROVIDER_INFO.length === 8, `PROVIDER_INFO 8 sağlayıcı içermeli (${PROVIDER_INFO.length}).`);
  const customInfo = PROVIDER_INFO.find((p) => p.id === "CUSTOM");
  assert(customInfo?.isLocal === true, "CUSTOM isLocal bayrağı true olmalı.");
  assert(
    customInfo?.baseUrlPlaceholder?.includes("11434") === true,
    "CUSTOM placeholder Ollama önerisi içermeli.",
  );
  for (const p of allProviders) {
    const models = getModelsForProvider(p);
    if (p === "CUSTOM") {
      assert(models.length === 0, "CUSTOM model listesi boş olmalı (serbest metin).");
    } else {
      assert(models.length > 0, `${p} model listesi boş olmamalı.`);
    }
  }
  check(
    "PROVIDER_INFO: 8 sağlayıcı + CUSTOM isLocal + model listeleri",
    true,
    "GEMINI/OPENAI/ANTHROPIC/DEEPSEEK/GROK/MISTRAL/NVIDIA/CUSTOM",
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
    console.error("\n✗ Script hata ile sonlandı:", errBrief(error));
    await prisma.$disconnect();
    process.exit(1);
  });
