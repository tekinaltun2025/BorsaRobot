import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/auth";

/**
 * Kimlik doğrulama middleware'i — /admin sayfası ve /api/admin/* route'larını
 * korur (iyileştirme 1.1).
 *
 * Davranış:
 *  - ADMIN_PASSWORD tanımlı değilse koruma devre dışıdır; istekler geçer
 *    (geliştirme modu — konsol uyarısı instrumentation'da verilir).
 *  - Sayfa istekleri (/admin): oturum yoksa /admin/login'e yönlendirilir.
 *  - API istekleri (/api/admin/*): oturum yoksa 401 JSON döner.
 *  - /api/admin/login ve /api/admin/logout her zaman açıktır (login döngüsü).
 *
 * Not: Next.js middleware Edge runtime'da koşar; bu yüzden auth mantığı
 * `src/lib/auth.ts` içinde yalnızca Web-uyumlu API'lerle (Buffer + timingSafeEqual
 * Node API'leridir ama Next middleware bundle'ı bunları polyfill eder) yazıldı.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Login/logout uçları her zaman açık.
  if (pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
    return NextResponse.next();
  }

  const session = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (isValidSession(session)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: "Yetkisiz erişim: yönetici oturumu gerekli." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

/** Middleware'in çalışacağı yollar. */
export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
