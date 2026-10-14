/**
 * secret-crypto'nun Edge derleme stub'ı.
 *
 * Next.js instrumentation.ts'yi hem Node hem Edge runtime için derler;
 * Edge bundle'ında Node built-in `crypto` çözülemez. Edge'de bu modülün
 * kodu asla koşmaz (instrumentation `NEXT_RUNTIME === "nodejs"` guard'ı
 * içerir) — yalnızca derlemenin geçmesi için tip-uyumlu boş gövde sağlanır.
 * next.config.ts'teki webpack alias yalnızca `edge-server` derlemesinde
 * bu stub'a yönlendirir; Node derlemesi gerçek modülü kullanır.
 */

export function encryptSecret(plain: string): string {
  throw new Error("encryptSecret yalnızca Node.js runtime'ında kullanılabilir.");
}

export function decryptSecret(value: string): string {
  throw new Error("decryptSecret yalnızca Node.js runtime'ında kullanılabilir.");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return false;
}
