/**
 * Ortak uygulama hata sınıfı — iyileştirme 4.3.
 *
 * TradingError, PriceServiceError, NewsServiceError, AnalysisServiceError,
 * Bist100SyncError hepsi aynı "message + code + httpStatus" desenini
 * kopyalıyordu. AppError bu deseni tek taban sınıfta toplar:
 *
 *  - API katmanı tek `instanceof AppError` kontrolüyle 4xx/5xx eşlemesi yapar.
 *  - Her servis kendi alt sınıfını türetir (isim/okunabilirlik korunur).
 *  - code: makine tarafından okunur (loglama, alarm kuralları).
 *  - httpStatus: API katmanına öneri; route'lar isterse override edebilir.
 */
export class AppError extends Error {
  constructor(
    message: string,
    /** Makine tarafından okunan hata kodu (örn. "NOT_FOUND", "VALIDATION"). */
    readonly code: string,
    /** API katmanına önerilen HTTP durum kodu. */
    readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = new.target.name;
    // Error alt sınıflarında prototype zincirini ES5 hedeflerinde korur.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
