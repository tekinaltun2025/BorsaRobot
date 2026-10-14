import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  createSessionValue,
  isAuthEnabled,
} from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Login gövde şeması — parola zorunlu, 200 karakter üst sınırı. */
const loginSchema = z.object({
  password: z.string().min(1, "Parola zorunludur.").max(200),
});

/**
 * POST /api/admin/login — yönetici oturumu açar.
 *
 * Sözleşme:
 *  - Gövde: { password } (Zod doğrulamalı).
 *  - ADMIN_PASSWORD tanımlı değilse 503 döner (koruma yapılandırılmamış).
 *  - Yanlış parola → 401 (mesaj parola doğruluğu hakkında ipucu vermez).
 *  - Başarı → HttpOnly + SameSite=Strict + Secure(üretim) oturum cookie'si.
 *  - Rate limit: IP başına dakikada 5 deneme (brute-force koruması).
 */
export async function POST(request: NextRequest) {
  // Brute-force koruması — login uçları en sıkı kurala tabidir.
  const limit = checkRateLimit(
    rateLimitKey("admin-login", clientIp(request.headers)),
    { windowMs: 60_000, max: 5 },
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Çok fazla başarısız deneme. Lütfen bir dakika sonra tekrar deneyin." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Doğrulama hatası.", details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  if (!isAuthEnabled()) {
    return NextResponse.json(
      {
        error:
          "Yönetici parolası yapılandırılmamış. .env dosyasına ADMIN_PASSWORD ekleyip sunucuyu yeniden başlatın.",
      },
      { status: 503 },
    );
  }

  const expected = process.env.ADMIN_PASSWORD!.trim();
  if (parsed.data.password.trim() !== expected) {
    return NextResponse.json({ error: "Parola hatalı." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: createSessionValue(expected),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
  return response;
}
