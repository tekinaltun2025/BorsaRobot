/**
 * Local AI model listesi çekme (POST /api/admin/list-models) doğrulama scripti.
 *
 * Kullanım: npx tsx scripts/verify-list-models.ts  (veya npm run verify:list-models)
 *
 * API key GEREKMEZ: gerçek LLM çağrısı yapılmaz; OpenAI-uyumlu /v1/models
 * sözleşmesi yerel mock HTTP sunucusuyla doğrulanır (verify-ai-providers.ts
 * mock deseni). Ollama kuruluysa gerçek canlı test de yapılır.
 *
 * Doğrulanan akışlar:
 *  1. Zod listModelsSchema: geçerli baseUrl kabul; şemasız URL reddi (422);
 *     boş baseUrl reddi; strict gövde (bilinmeyen alan reddi).
 *  2. Mock /v1/models: data[].id parse → alfabetik sıralı, tekrarsız liste.
 *  3. Mock /v1/models: ek alanlar (object, owned_by, created) passthrough ile
 *     kabul edilir; yanıt sözleşmesi esnektir.
 *  4. Mock 401 → INVALID_API_KEY sınıflandırması (401 + TR mesaj).
 *  5. Mock boş data → 200 + models: [] (boş liste hata değildir).
 *  6. Mock geçersiz format (data yok) → 502 + TR mesaj.
 *  7. Erişilemeyen sunucu (kapalı port) → 502 ağ hatası + TR mesaj.
 *  8. API key'li istek → Authorization: Bearer header'ı eklenir (mock kanıtı);
 *     key'siz istekte header hiç gönderilmez.
 *  9. Ollama canlı test (varsa): http://localhost:11434/v1/models gerçek çağrı.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { listModelsSchema } from "../src/lib/validators/admin-settings";

/** Test sonucu toplayıcı — verify-ai-providers.ts deseni. */
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Doğrulama başarısız: ${message}`);
}

function errBrief(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mock OpenAI-uyumlu HTTP sunucusu — handler'a istek/yanıt kontrolü bırakır. */
function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
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
        url,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

/**
 * list-models API'sinin çekirdek mantığını birebir uygular (route.ts ile aynı
 * sözleşme): GET {baseUrl}/models → Zod doğrulama → alfabetik sıralı liste.
 * Route'un kendisi Next.js runtime'ına bağlı olduğundan doğrulama bu izole
 * kopya + mock sunucu üzerinden yapılır; sözleşme birebir aynıdır.
 */
async function fetchModelsFromServer(params: {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<{ ok: true; models: string[] } | { ok: false; status: number; error: string }> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 401,
        error:
          "Sunucu API anahtarını reddetti (401). Local AI API Key alanını kontrol edin — Ollama key istemez, boş bırakabilirsiniz.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: `Sunucu ${response.status} durum kodu döndü. Base URL'nin OpenAI-uyumlu kök adresi olduğundan emin olun (örn. http://localhost:11434/v1).`,
      };
    }
    const raw: unknown = await response.json().catch(() => null);
    const parsed = z
      .object({
        data: z.array(z.object({ id: z.string().min(1) }).passthrough()).max(1000),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        status: 502,
        error:
          "Sunucu yanıtı OpenAI-uyumlu /v1/models formatında değil (data[].id bekleniyor). Base URL /v1 ile bitiyor mu?",
      };
    }
    const models = Array.from(new Set(parsed.data.data.map((m) => m.id))).sort((a, b) =>
      a.localeCompare(b),
    );
    return { ok: true, models };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        error: "Sunucu 10 saniye içinde yanıt vermedi (zaman aşımı). Sunucunun çalıştığından emin olun.",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "Sunucuya ulaşılamadı (ağ hatası). Sunucu çalışıyor mu? Örn. Ollama için: ollama serve",
    };
  } finally {
    clearTimeout(timer);
  }
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
  console.log("=== LOCAL AI MODEL LİSTESİ ÇEKME DOĞRULAMA (/api/admin/list-models) ===\n");

  // ============================================================
  // 1) Zod listModelsSchema — doğrulama sözleşmesi.
  // ============================================================
  const validParse = listModelsSchema.safeParse({ baseUrl: "http://localhost:11434/v1" });
  assert(validParse.success, "Geçerli baseUrl şema tarafından kabul edilmedi.");
  check("Zod: geçerli baseUrl kabul", true, "http://localhost:11434/v1");

  const noSchemeParse = listModelsSchema.safeParse({ baseUrl: "localhost:11434/v1" });
  assert(!noSchemeParse.success, "http/https şemasız URL reddedilmedi.");
  check("Zod: şemasız URL reddedilir (422)", true, "localhost:11434/v1 → hata");

  const emptyUrlParse = listModelsSchema.safeParse({ baseUrl: "" });
  assert(!emptyUrlParse.success, "Boş baseUrl reddedilmedi.");
  check("Zod: boş baseUrl reddedilir (422)", true, "boş string → hata");

  const strictParse = listModelsSchema.safeParse({
    baseUrl: "http://localhost:11434/v1",
    extraField: "yasak",
  });
  assert(!strictParse.success, "Bilinmeyen alan strict gövde tarafından reddedilmedi.");
  check("Zod: strict gövde — bilinmeyen alan reddi", true, "extraField → hata");

  const keyParse = listModelsSchema.safeParse({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "lm-studio-key-1234",
  });
  assert(keyParse.success, "opsiyonel apiKey kabul edilmedi.");
  check("Zod: opsiyonel apiKey kabul", true, "apiKey: lm-studio-key-1234");

  // ============================================================
  // 2) Mock /v1/models — parse + alfabetik sıralama + tekrarsızlık.
  // ============================================================
  const mockServer1 = await startMockServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "qwen2.5", object: "model", owned_by: "ollama" },
          { id: "llama3.2", object: "model", owned_by: "ollama" },
          { id: "mistral-7b-instruct", object: "model", owned_by: "ollama" },
          { id: "llama3.2", object: "model", owned_by: "ollama" }, // tekrar — Set ile elenmeli
        ],
      }),
    );
  });
  const result1 = await fetchModelsFromServer({ baseUrl: `${mockServer1.url}/v1` });
  assert(result1.ok, "Mock /v1/models çağrısı başarısız.");
  assert(
    JSON.stringify(result1.models) ===
      JSON.stringify(["llama3.2", "mistral-7b-instruct", "qwen2.5"]),
    `Alfabetik sıralı tekrarsız liste bekleniyor, gelen: ${JSON.stringify(result1.models)}`,
  );
  check(
    "Mock /v1/models: parse + alfabetik sıralı + tekrarsız",
    true,
    result1.models.join(", "),
  );
  await mockServer1.close();

  // ============================================================
  // 3) Mock /v1/models — ek alanlar passthrough ile kabul.
  // ============================================================
  const mockServer2 = await startMockServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          {
            id: "gpt-oss-20b",
            object: "model",
            created: 1757000000,
            owned_by: "ollama",
            permission: [],
          },
        ],
      }),
    );
  });
  const result2 = await fetchModelsFromServer({ baseUrl: `${mockServer2.url}/v1` });
  assert(result2.ok, "Ek alanlı yanıt parse edilemedi.");
  assert(result2.models.length === 1 && result2.models[0] === "gpt-oss-20b", "Ek alanlı model adı yanlış parse edildi.");
  check("Mock /v1/models: ek alanlar passthrough kabul", true, "gpt-oss-20b (created/owned_by/permission)");
  await mockServer2.close();

  // ============================================================
  // 4) Mock 401 → INVALID_API_KEY sınıflandırması.
  // ============================================================
  const mockServer3 = await startMockServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
  });
  const result3 = await fetchModelsFromServer({
    baseUrl: `${mockServer3.url}/v1`,
    apiKey: "wrong-key",
  });
  assert(!result3.ok, "401 yanıtı hata olarak sınıflandırılmadı.");
  if (result3.ok) throw new Error("unreachable");
  assert(result3.status === 401, `401 bekleniyor, gelen: ${result3.status}`);
  assert(result3.error.includes("API anahtarını reddetti"), "401 TR mesajı beklenen içeriği taşımıyor.");
  check("Mock 401 → INVALID_API_KEY (401 + TR mesaj)", true, result3.error.slice(0, 70));
  await mockServer3.close();

  // ============================================================
  // 5) Mock boş data → 200 + boş liste (hata değil).
  // ============================================================
  const mockServer4 = await startMockServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [] }));
  });
  const result4 = await fetchModelsFromServer({ baseUrl: `${mockServer4.url}/v1` });
  assert(result4.ok, "Boş data hata olarak sınıflandırıldı — 200 + [] olmalı.");
  assert(result4.models.length === 0, "Boş data boş liste döndürmeli.");
  check("Mock boş data → 200 + models: []", true, "boş liste hata değildir");
  await mockServer4.close();

  // ============================================================
  // 6) Mock geçersiz format → 502 + TR mesaj.
  // ============================================================
  const mockServer5 = await startMockServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ unexpected: "shape" }));
  });
  const result5 = await fetchModelsFromServer({ baseUrl: `${mockServer5.url}/v1` });
  assert(!result5.ok, "Geçersiz format hata olarak sınıflandırılmadı.");
  if (result5.ok) throw new Error("unreachable");
  assert(result5.status === 502, `502 bekleniyor, gelen: ${result5.status}`);
  assert(result5.error.includes("formatında değil"), "502 TR mesajı beklenen içeriği taşımıyor.");
  check("Mock geçersiz format → 502 + TR mesaj", true, result5.error.slice(0, 70));
  await mockServer5.close();

  // ============================================================
  // 7) Erişilemeyen sunucu → 502 ağ hatası + TR mesaj.
  // ============================================================
  const result6 = await fetchModelsFromServer({
    baseUrl: "http://127.0.0.1:1", // kapalı port — connection refused
    timeoutMs: 3000,
  });
  assert(!result6.ok, "Erişilemeyen sunucu hata olarak sınıflandırılmadı.");
  if (result6.ok) throw new Error("unreachable");
  assert(result6.status === 502, `502 bekleniyor, gelen: ${result6.status}`);
  assert(result6.error.includes("ulaşılamadı"), "Ağ hatası TR mesajı beklenen içeriği taşımıyor.");
  check("Erişilemeyen sunucu → 502 ağ hatası + TR mesaj", true, result6.error.slice(0, 70));

  // ============================================================
  // 8) Authorization header kanıtı — key'li ve key'siz istekler.
  // ============================================================
  let capturedAuth: string | null = null;
  const mockServer6 = await startMockServer((req, res) => {
    capturedAuth = req.headers.authorization ?? null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "llama3.2" }] }));
  });
  await fetchModelsFromServer({
    baseUrl: `${mockServer6.url}/v1`,
    apiKey: "local-secret-9876",
  });
  assert(
    capturedAuth === "Bearer local-secret-9876",
    `API key'li istekte Authorization header eklenmedi (gelen: ${capturedAuth}).`,
  );
  check("API key'li istek → Authorization: Bearer eklenir", true, `header=${capturedAuth}`);

  capturedAuth = null;
  await fetchModelsFromServer({ baseUrl: `${mockServer6.url}/v1` });
  assert(
    capturedAuth === null || capturedAuth === undefined,
    `Key'siz istekte Authorization header gönderildi (gelen: ${capturedAuth}).`,
  );
  check("Key'siz istek → Authorization header gönderilmez", true, "Ollama uyumlu davranış");
  await mockServer6.close();

  // ============================================================
  // 9) Ollama canlı test (varsa) — gerçek /v1/models çağrısı.
  // ============================================================
  const ollamaRunning = await isOllamaRunning();
  if (ollamaRunning) {
    const liveResult = await fetchModelsFromServer({
      baseUrl: "http://localhost:11434/v1",
      timeoutMs: 8000,
    });
    assert(liveResult.ok, "Ollama canlı /v1/models çağrısı başarısız.");
    check(
      "Ollama canlı test: /v1/models gerçek liste",
      liveResult.models.length > 0,
      `${liveResult.models.length} model: ${liveResult.models.slice(0, 5).join(", ")}${liveResult.models.length > 5 ? ", …" : ""}`,
    );
  } else {
    check(
      "Ollama canlı test: atlandı",
      true,
      "Ollama kurulu değil (http://localhost:11434 yanıt vermedi) — mock testler kapsıyor.",
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
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("\n✗ Script hata ile sonlandı:", errBrief(error));
    process.exit(1);
  });
