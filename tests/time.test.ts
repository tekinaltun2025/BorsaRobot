import { describe, expect, it } from "vitest";
import { appDayStart, APP_TIME_ZONE, appTimeZoneOffsetMinutes } from "@/lib/time";

describe("appTimeZoneOffsetMinutes", () => {
  it("Europe/Istanbul kalıcı UTC+3 ofseti döndürür", () => {
    // 2026-10-11 12:00 UTC → TR 15:00 → ofset +180 dk.
    const at = new Date("2026-10-11T12:00:00Z");
    expect(appTimeZoneOffsetMinutes(at)).toBe(180);
  });

  it("kış saatinde de +3 kalır (DST yok, 2016'dan beri)", () => {
    const at = new Date("2026-01-15T12:00:00Z");
    expect(appTimeZoneOffsetMinutes(at)).toBe(180);
  });
});

describe("appDayStart", () => {
  it("UTC öğleden sonrayı TR gün başlangıcına çevirir", () => {
    // 2026-10-11 20:30 UTC = TR 23:30 (11 Ekim) → gün başı TR 11 Ekim 00:00
    // = UTC 10 Ekim 21:00.
    const now = new Date("2026-10-11T20:30:00Z");
    const dayStart = appDayStart(now);
    expect(dayStart.toISOString()).toBe("2026-10-10T21:00:00.000Z");
  });

  it("TR gece yarısı sonrası (UTC 21:00-24:00) aynı günün başına düşer", () => {
    // 2026-10-11 22:00 UTC = TR 12 Ekim 01:00 → gün başı TR 12 Ekim 00:00
    // = UTC 11 Ekim 21:00.
    const now = new Date("2026-10-11T22:00:00Z");
    const dayStart = appDayStart(now);
    expect(dayStart.toISOString()).toBe("2026-10-11T21:00:00.000Z");
  });

  it("TR sabahı (UTC 04:00) aynı UTC gününün 21:00'ine düşer", () => {
    // 2026-10-11 04:00 UTC = TR 07:00 → gün başı TR 11 Ekim 00:00 =
    // UTC 10 Ekim 21:00 (önceki UTC günü).
    const now = new Date("2026-10-11T04:00:00Z");
    const dayStart = appDayStart(now);
    expect(dayStart.toISOString()).toBe("2026-10-10T21:00:00.000Z");
  });

  it("dönen an, now'dan sonraki her zaman için now'dan öncekidir", () => {
    const now = new Date();
    expect(appDayStart(now).getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("sabit TZ adı Europe/Istanbul'dur", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Istanbul");
  });
});
