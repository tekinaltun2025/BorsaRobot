/**
 * Zaman yardımcıları — iş mantığı saat dilimi sabitlemesi (iyileştirme 6.4).
 *
 * BorsaRobot BIST (Europe/Istanbul) uygulamasıdır; "günlük bütçe" gibi
 * gün-sınırlı iş kuralları sunucunun yerel TZ'sine değil, borsa saat
 * dilimine bağlanmalıdır. Sunucu UTC'de ya da başka bir TZ'de dağıtılsa
 * bile pencere kaymaz.
 */

/** Uygulamanın iş saat dilimi — BIST (Europe/Istanbul). */
export const APP_TIME_ZONE = "Europe/Istanbul";

/**
 * Verilen anın, APP_TIME_ZONE'daki gün başlangıcını (yerel gece 00:00,
 * TR saatiyle) UTC Date olarak döndürür.
 *
 * Uygulama: risk-service günlük alım bütçesi penceresi (iyileştirme 6.4 —
 * eski kod `dayStart.setHours(0,0,0,0)` sunucu TZ'sine göre kayıyordu).
 *
 * Yöntem: hedef TZ'de "bugün"ün Y-M-D parçaları Intl ile okunur; TZ
 * ofsetiyle UTC gece yarısına çevrilir. DST geçiş günlerinde 23:00/01:00
 * başlangıcı oluşabilir — bu, TZ kuralının kendisidir ve bütçe penceresi
 * için kabul edilebilir.
 */
export function appDayStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // en-CA formatı: YYYY-MM-DD — ISO'ya doğrudan uyumlu.
  const utcMidnight = new Date(`${parts}T00:00:00Z`);
  if (Number.isNaN(utcMidnight.getTime())) {
    // Savunma: beklenmedik format hatasında yerel gün başına düş.
    const fallback = new Date(now);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
  // UTC gece yarısı + TZ ofseti = TR gün başlangıcı (UTC cinsinden).
  const offsetMinutes = appTimeZoneOffsetMinutes(utcMidnight);
  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000);
}

/**
 * Verilen anda APP_TIME_ZONE'ın UTC ofseti (dakika). Europe/Istanbul
 * kalıcı UTC+3'tür (2016'dan beri DST yok); yine de Intl'den okunur —
 * kural değişirse kod değişmez.
 */
export function appTimeZoneOffsetMinutes(at: Date = new Date()): number {
  // formatToParts + Date.UTC deseni: `new Date(format(...))` string'i SİSTEM
  // lokali olarak parse ettiğinden ofset kayboluyordu (UTC sunucuda 0
  // dönüyordu). Parçalar elle UTC'ye çevrilir — hesap parse TZ'sinden
  // bağımsızdır ve sunucu TZ'si ne olursa olsun doğru ofseti verir.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  if (
    [year, month, day, hour, minute, second].some((value) =>
      Number.isNaN(value),
    )
  ) {
    return 180; // +03:00 varsayılan (Europe/Istanbul kalıcı ofseti)
  }
  // %24 savunması: hourCycle desteklenmeyen eski motorlar hour12:false'u
  // h24 olarak yorumlayıp "24" döndürebilir.
  const asUtc = Date.UTC(year, month - 1, day, hour % 24, minute, second);
  return (asUtc - at.getTime()) / 60_000;
}
