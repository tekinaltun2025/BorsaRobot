import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * Yönetim paneli kimlik doğrulaması — HMAC imzalı cookie tabanlı basit auth.
 *
 * Tasarım:
 *  - `ADMIN_PASSWORD` env değişkeni ayarlıysa koruma AKTİFTİR: /admin sayfası
 *    ve /api/admin/* route'ları geçerli oturum cookie'si ister.
 *  - `ADMIN_PASSWORD` boşsa koruma DEVRE DIŞIDIR (geliştirme kolaylığı) —
 *    bu durumda her istek kabul edilir ve konsola tek seferlik uyarı düşer.
 *  - Oturum cookie'si: `borsarobot_admin` = HMAC-SHA256(ADMIN_PASSWORD, "admin-session")
 *    — parolanın kendisi asla cookie'ye yazılmaz; yalnızca türetilmiş imza taşınır.
 *  - Karşılaştırma `timingSafeEqual` ile yapılır (timing attack koruması).
 *
 * Not: Tek yöneticili kurulum için yeterlidir; çok kullanıcılı yapıya geçişte
 * NextAuth/Auth.js'e taşınması planlanmıştır (plans/iyilestirme-listesi.md 1.1).
 */

/** Oturum cookie adı. */
export const ADMIN_SESSION_COOKIE = "borsarobot_admin";

/** Oturum süresi (sn) — 12 saat. */
export const ADMIN_SESSION_MAX_AGE = 12 * 60 * 60;

/** Koruma aktif mi? ADMIN_PASSWORD tanımlı ve boş değilse aktif. */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

/** Paroladan türetilen oturum imzası — parola asla doğrudan taşınmaz. */
function sessionToken(password: string): string {
  return createHmac("sha256", password).update("admin-session-v1").digest("hex");
}

/** Verilen parola ile oturum cookie değerini üretir (login route kullanır). */
export function createSessionValue(password: string): string {
  return sessionToken(password.trim());
}

/**
 * İsteğin oturum cookie'si geçerli mi?
 * Koruma devre dışıysa her zaman true döner.
 */
export function isValidSession(cookieValue: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!cookieValue) return false;
  const expected = sessionToken(process.env.ADMIN_PASSWORD!.trim());
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Server Component / Route Handler içinden oturum kontrolü. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidSession(store.get(ADMIN_SESSION_COOKIE)?.value);
}
