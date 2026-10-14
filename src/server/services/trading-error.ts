import { AppError } from "@/lib/app-error";

/**
 * Emir iş akışındaki bilinen, kullanıcıya dönük hata kodları.
 * API katmanı bu kodları HTTP 4xx'e map eder.
 */
export type TradingErrorCode =
  | "VALIDATION"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_POSITION"
  | "RISK_LIMIT"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "LIVE_MODE_NOT_CONFIRMED"
  | "INVALID_STATE";

/**
 * Kullanıcıya dönük, bilinen iş kuralı ihlali — API katmanı 4xx'e map eder.
 *
 * (iyileştirme 4.2/4.3) Sınıf trading-service.ts'ten ayrı modüle taşındı:
 * risk-service.ts ve trading-service.ts aynı hata sözleşmesini paylaşır;
 * ayrı modül, servisler arası dairesel import'u önler. trading-service.ts
 * geriye dönük uyumluluk için sınıfı re-export eder.
 */
export class TradingError extends AppError {
  constructor(
    message: string,
    code: TradingErrorCode,
    httpStatus: number = 400,
  ) {
    super(message, code, httpStatus);
  }
}
