/**
 * Bellek-içi token-bucket rate limiter — tek process'li Next.js kurulumu için.
 *
 * Kapsam:
 *  - LLM çağıran pahalı endpoint'ler (/api/ai-decisions/ask, /api/analysis,
 *    /api/auto-trade/run, /api/admin/test-ai, /api/admin/list-models) ve
 *    genel yazma endpoint'leri için istek sınırlama.
 *  - Anahtar: IP (x-forwarded-for / x-real-ip) + route etiketi.
 *  - Sabit pencere (fixed window): pencere başına maksimum istek sayısı.
 *
 * Sınırlar:
 *  - Tek process belleğinde tutulur; çok instance'lı dağıtımda instance
 *    başına uygulanır (dağıtık limiter için Redis planı: iyileştirme 1.3).
 *  - Map büyümesi: her girişte süresi geçmiş anahtarlar temizlenir (leak koruması).
 */

/** Tek pencere kaydı. */
interface Bucket {
  /** Pencere başlangıcı (ms). */
  windowStart: number;
  /** Pencerede atılan istek sayısı. */
  count: number;
}

const buckets = new Map<string, Bucket>();

/** Map'in maksimum anahtar sayısı — anormal büyümeye karşı sert üst sınır. */
const MAX_BUCKETS = 10_000;

/** Limiter kuralı — route etiketi başına pencere + limit. */
export interface RateLimitRule {
  /** Pencere süresi (ms). */
  windowMs: number;
  /** Pencere başına maksimum istek. */
  max: number;
}

/** Varsayılan kurallar — endpoint etiketine göre. */
export const RATE_LIMIT_RULES: Record<string, RateLimitRule> = {
  // LLM çağıran pahalı uçlar: dakikada 10 istek.
  "ai-ask": { windowMs: 60_000, max: 10 },
  "ai-analysis": { windowMs: 60_000, max: 10 },
  "ai-chat": { windowMs: 60_000, max: 20 },
  "auto-trade-run": { windowMs: 60_000, max: 6 },
  "admin-test": { windowMs: 60_000, max: 10 },
  "admin-list-models": { windowMs: 60_000, max: 10 },
  // Emir uçları: dakikada 30 (manuel kullanım rahat, bot dar).
  "trading-write": { windowMs: 60_000, max: 30 },
  // Genel API: dakikada 120.
  "api-general": { windowMs: 60_000, max: 120 },
};

/** Limiter sonucu. */
export interface RateLimitResult {
  /** İsteğe izin verildi mi? */
  allowed: boolean;
  /** Pencerede kalan istek hakkı. */
  remaining: number;
  /** Pencerenin sıfırlanmasına kalan süre (sn) — Retry-After header'ı için. */
  retryAfterSeconds: number;
}

/**
 * İsteği sınırlar. `allowed=false` dönerse çağıran 429 ile reddetmelidir.
 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // Periyodik temizlik: map büyürse süresi geçmiş pencereleri düşür.
  if (buckets.size > MAX_BUCKETS / 2) {
    for (const [k, v] of buckets) {
      if (now - v.windowStart >= rule.windowMs * 4) buckets.delete(k);
    }
  }
  if (buckets.size >= MAX_BUCKETS) {
    // Sert koruma: en eski girişleri düşür (DoS'a karşı).
    const excess = buckets.size - MAX_BUCKETS + 1;
    let dropped = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++dropped >= excess) break;
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= rule.windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: rule.max - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStart + rule.windowMs - now) / 1000),
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: rule.max - bucket.count,
    retryAfterSeconds: 0,
  };
}

/**
 * İstekten istemci IP'sini çıkarır (proxy arkası dahil).
 * IP alınamazsa "unknown" — tek kova paylaşılır (güvenli tarafta hata).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Route etiketi + istek için birleşik limiter anahtarı.
 */
export function rateLimitKey(scope: string, ip: string): string {
  return `${scope}:${ip}`;
}
