import { prisma } from "@/lib/prisma";

/**
 * ApiCallLog yazma helper'ı — servis katmanına ait (Bölüm 3.2 kuralı:
 * provider'lar Prisma'ya dokunmaz; log helper'ı kendilerine enjekte edilir).
 *
 * LLM çağrıları da DenizBank çağrıları gibi izlenebilirlik gerektirir:
 * istek/yanıt özeti, süre, token bilgisi ve hata durumu kaydedilir.
 *
 * Log yazımı asla ana akışı bozmaz — log hatası çağrıyı düşürmez.
 */

/** ApiCallLog girişi — LLM ve dış servis çağrıları için ortak sözleşme. */
export interface ApiCallLogEntry {
  /** Çağrılan endpoint (örn. "LLM:GEMINI:gemini-2.0-flash"). */
  endpoint: string;
  /** Ham istek gövdesi/özeti (sır içermeyen haliyle). */
  requestBody: string;
  /** Ham yanıt gövdesi/özeti (varsa). */
  responseBody?: string | null;
  /** HTTP durum kodu (varsa). */
  httpStatus?: number | null;
  /** Hata sınıfı: TRANSIENT | PERMANENT | DEFERRED | UNKNOWN. */
  errorClass?: string | null;
  /** Hata kodu (örn. "TIMEOUT", "INVALID_API_KEY"). */
  errorCode?: string | null;
  /** Süre (ms). */
  durationMs?: number | null;
}

/**
 * Api çağrısını ApiCallLog'a yazar. Hata durumunda yalnızca konsola loglar —
 * çağıran akış asla kesilmez (log yazımı best-effort'tur).
 */
export async function logApiCall(entry: ApiCallLogEntry): Promise<void> {
  try {
    await prisma.apiCallLog.create({
      data: {
        endpoint: entry.endpoint,
        requestBody: entry.requestBody.slice(0, 4000),
        responseBody: entry.responseBody ? entry.responseBody.slice(0, 4000) : null,
        httpStatus: entry.httpStatus ?? null,
        errorClass: entry.errorClass ?? null,
        errorCode: entry.errorCode ?? null,
        durationMs: entry.durationMs ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("[api-log] ApiCallLog kaydı yazılamadı:", error);
  }
}
