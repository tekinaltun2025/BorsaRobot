import { z } from "zod";

/**
 * LLM analiz çıktısı doğrulama şeması — ADR-9.
 *
 * LLM çıktıları güvenilmezdir; emir motoruna (Faz 5) giden her analiz bu
 * şemadan geçmek ZORUNDUR. Şema dışı çıktı → analiz FAILED kabul edilir,
 * emir ÜRETİLMEZ, hata AiAnalysisLog.validationError'a yazılır.
 *
 * coerce notu: LLM'ler sayısal alanları bazen string döndürür ("0.8");
 * z.coerce.number() bunları güvenle sayıya çevirir, çevrilemeyen değerler
 * (NaN) min/max kontrollerinde reddedilir.
 */
export const aiAnalysisSchema = z.object({
  /** Karar: BUY | SELL | HOLD — başka hiçbir değer kabul edilmez. */
  action: z.enum(["BUY", "SELL", "HOLD"]),
  /** Güven skoru: 0.0–1.0. */
  confidence: z.coerce.number().min(0).max(1),
  /** Karar gerekçesi — kullanıcıya gösterilir, boş olamaz. */
  reasoning: z.string().min(1).max(4000),
  /** Öne çıkan riskler (opsiyonel, en fazla 10 madde). */
  risks: z.array(z.string().min(1).max(500)).max(10).optional(),
  /** Hedef fiyat (TL, opsiyonel) — yalnızca bilgilendirme amaçlı. */
  targetPrice: z.coerce.number().positive().max(1_000_000).optional(),
  /** Risk seviyesi (opsiyonel). */
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});

/** Doğrulanmış analiz — parser ve analiz servisinin ortak sözleşmesi. */
export type ValidatedAiAnalysis = z.infer<typeof aiAnalysisSchema>;
