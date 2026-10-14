import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { listModelsSchema } from "@/lib/validators/admin-settings";
import { logApiCall } from "@/server/services/api-log-service";
import { prisma } from "@/lib/prisma";
import { guardRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/** Model listesi çekme zaman aşımı (ms) — local sunucular için cömert üst sınır. */
const LIST_MODELS_TIMEOUT_MS = 10_000;

/**
 * OpenAI-uyumlu /v1/models yanıt şeması — `data` dizisi zorunlu; her öğede
 * yalnızca `id` string zorunludur, ek alanlar (object, owned_by, created vb.)
 * passthrough ile serbest bırakılır.
 */
const modelsResponseSchema = z.object({
  data: z
    .array(z.object({ id: z.string().min(1) }).passthrough())
    .max(1000, "Model listesi 1000 öğeyi aştı."),
});

/**
 * POST /api/admin/list-models — Local AI sunucusundan kurulu model listesini çeker.
 *
 * Sözleşme:
 *  - Gövde: { baseUrl, apiKey? } (Zod doğrulamalı; http/https şeması zorunlu).
 *    baseUrl OpenAI-uyumlu kök adresidir ve /v1 ile biter (örn.
 *    http://localhost:11434/v1) → istek GET {baseUrl}/models olarak atılır.
 *  - apiKey gönderilmediyse DB'deki kayıtlı customApiKey kullanılır (kullanıcı
 *    key'i bir kez kaydettiyse listeyi yeniden girmeden çekebilir).
 *  - Authorization: Bearer header'ı yalnızca key mevcutsa eklenir (Ollama key
 *    istemez; boş "Bearer " bazı sunucularda 401 üretir).
 *  - Timeout 10 sn (AbortController); hata sınıflandırması TR mesajlarla:
 *    ağ hatası 502, zaman aşımı 504, geçersiz key 401, doğrulama 422.
 *  - Yanıt: { models: ["llama3.2", "qwen2.5", ...] } — alfabetik sıralı.
 *    Boş liste hata değildir (200 + models: []).
 *  - Her istek ApiCallLog'a yazılır (key asla loglanmaz, maskeli özet tutulur).
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, "admin-list-models");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = listModelsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Doğrulama hatası.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const baseUrl = parsed.data.baseUrl.replace(/\/+$/, "");
  const startedAt = Date.now();
  const endpoint = "LLM:MODELS";

  // İstemci key göndermediyse DB'deki kayıtlı local AI key'ini kullan.
  let apiKey = parsed.data.apiKey?.trim() ?? "";
  if (!apiKey) {
    try {
      const settings = await prisma.adminSettings.findUnique({
        where: { id: "singleton" },
        select: { customApiKey: true },
      });
      apiKey = settings?.customApiKey?.trim() ?? "";
    } catch {
      // DB okunamadıysa key'siz devam — local AI'da genelde yeterli.
    }
  }
  const requestSummaryLogged = JSON.stringify({
    baseUrl,
    hasApiKey: apiKey.length > 0,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const durationMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      await logApiCall({
        endpoint,
        requestBody: requestSummaryLogged,
        httpStatus: response.status,
        errorClass: "PERMANENT",
        errorCode: "INVALID_API_KEY",
        durationMs,
      });
      return NextResponse.json(
        {
          error:
            "Sunucu API anahtarını reddetti (401). Local AI API Key alanını kontrol edin — Ollama key istemez, boş bırakabilirsiniz.",
        },
        { status: 401 },
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      await logApiCall({
        endpoint,
        requestBody: requestSummaryLogged,
        responseBody: bodyText.slice(0, 500),
        httpStatus: response.status,
        errorClass: "PERMANENT",
        errorCode: "UPSTREAM_ERROR",
        durationMs,
      });
      return NextResponse.json(
        {
          error: `Sunucu ${response.status} durum kodu döndü. Base URL'nin OpenAI-uyumlu kök adresi olduğundan emin olun (örn. http://localhost:11434/v1).`,
        },
        { status: 502 },
      );
    }

    const raw: unknown = await response.json().catch(() => null);
    const modelsParsed = modelsResponseSchema.safeParse(raw);
    if (!modelsParsed.success) {
      await logApiCall({
        endpoint,
        requestBody: requestSummaryLogged,
        httpStatus: response.status,
        errorClass: "PERMANENT",
        errorCode: "INVALID_RESPONSE",
        durationMs,
      });
      return NextResponse.json(
        {
          error:
            "Sunucu yanıtı OpenAI-uyumlu /v1/models formatında değil (data[].id bekleniyor). Base URL /v1 ile bitiyor mu?",
        },
        { status: 502 },
      );
    }

    // Alfabetik sıralı, tekrarsız model kimlikleri.
    const models = Array.from(
      new Set(modelsParsed.data.data.map((m) => m.id)),
    ).sort((a, b) => a.localeCompare(b));

    await logApiCall({
      endpoint,
      requestBody: requestSummaryLogged,
      responseBody: JSON.stringify({ modelCount: models.length }),
      httpStatus: 200,
      durationMs,
    });

    return NextResponse.json({ models });
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof Error && error.name === "AbortError") {
      await logApiCall({
        endpoint,
        requestBody: requestSummaryLogged,
        httpStatus: null,
        errorClass: "TRANSIENT",
        errorCode: "TIMEOUT",
        durationMs,
      });
      return NextResponse.json(
        {
          error: `Sunucu ${LIST_MODELS_TIMEOUT_MS / 1000} saniye içinde yanıt vermedi (zaman aşımı). Sunucunun çalıştığından emin olun.`,
        },
        { status: 504 },
      );
    }

    await logApiCall({
      endpoint,
      requestBody: requestSummaryLogged,
      httpStatus: null,
      errorClass: "TRANSIENT",
      errorCode: "NETWORK_ERROR",
      durationMs,
    });
    return NextResponse.json(
      {
        error:
          "Sunucuya ulaşılamadı (ağ hatası). Sunucu çalışıyor mu? Örn. Ollama için: ollama serve",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
