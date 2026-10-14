import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  clientIp,
  rateLimitKey,
  RATE_LIMIT_RULES,
  type RateLimitRule,
} from "@/lib/rate-limit";

/** RATE_LIMIT_RULES içinde tanımlı bilinen scope adları. */
export type RateLimitScope = keyof typeof RATE_LIMIT_RULES;

/** Bilinmeyen scope'lar için varsayılan kural: dakikada 120 istek. */
const DEFAULT_RULE: RateLimitRule = { windowMs: 60_000, max: 120 };

/**
 * Route handler'ları için birleşik guard: rate limit + 429 yanıtı.
 *
 * Kullanım (route içinde):
 *   const guard = guardRequest(request, "trading-write");
 *   if (guard) return guard;
 *
 * Dönen NextResponse varsa istek REDDEDİLMİŞTİR (429); yoksa devam edilebilir.
 */
export function guardRequest(
  request: NextRequest,
  scope: RateLimitScope | string,
  ruleOverride?: RateLimitRule,
): NextResponse | null {
  const rule =
    ruleOverride ?? RATE_LIMIT_RULES[scope as RateLimitScope] ?? DEFAULT_RULE;

  const result = checkRateLimit(rateLimitKey(scope, clientIp(request.headers)), rule);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: "İstek sınırı aşıldı. Lütfen kısa süre sonra tekrar deneyin." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
