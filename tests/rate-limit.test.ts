import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, rateLimitKey, clientIp } from "@/lib/rate-limit";

describe("rate-limit — sabit pencere limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pencere içindeki ilk isteklere izin verir", () => {
    const rule = { windowMs: 60_000, max: 3 };
    expect(checkRateLimit("k1", rule).allowed).toBe(true);
    expect(checkRateLimit("k1", rule).allowed).toBe(true);
    expect(checkRateLimit("k1", rule).allowed).toBe(true);
  });

  it("limit aşıldığında reddeder ve Retry-After döner", () => {
    const rule = { windowMs: 60_000, max: 2 };
    checkRateLimit("k2", rule);
    checkRateLimit("k2", rule);
    const blocked = checkRateLimit("k2", rule);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("pencere sıfırlandığında izin yeniden başlar", () => {
    const rule = { windowMs: 1_000, max: 1 };
    expect(checkRateLimit("k3", rule).allowed).toBe(true);
    expect(checkRateLimit("k3", rule).allowed).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect(checkRateLimit("k3", rule).allowed).toBe(true);
  });

  it("farklı anahtarlar bağımsız sayaç tutar", () => {
    const rule = { windowMs: 60_000, max: 1 };
    expect(checkRateLimit("a", rule).allowed).toBe(true);
    expect(checkRateLimit("b", rule).allowed).toBe(true);
    expect(checkRateLimit("a", rule).allowed).toBe(false);
  });

  it("kalan hak sayısını doğru raporlar", () => {
    const rule = { windowMs: 60_000, max: 5 };
    const first = checkRateLimit("k4", rule);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);
  });

  it("rateLimitKey scope ve IP'yi birleştirir", () => {
    expect(rateLimitKey("ai-ask", "1.2.3.4")).toBe("ai-ask:1.2.3.4");
  });

  it("clientIp x-forwarded-for'dan ilk IP'yi okur", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.50, 70.41.3.18",
    });
    expect(clientIp(headers)).toBe("203.0.113.50");
  });

  it("clientIp x-real-ip'ye düşer", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(clientIp(headers)).toBe("198.51.100.7");
  });

  it("IP yoksa 'unknown' döner", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
