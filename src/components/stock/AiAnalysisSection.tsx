"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BrainCircuit,
  CircleAlert,
  ExternalLink,
  History,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { AiAction } from "@/lib/types";

/**
 * AI Analizi bölümü — /stock/[symbol] detay sayfası.
 *
 * Davranış sözleşmesi:
 *  - "Analiz Et" → POST /api/analysis?symbol=XXX (LLM çağrısı).
 *  - Sonuç kartı: action badge (BUY yeşil / SELL kırmızı / HOLD gri),
 *    confidence bar, reasoning, model/sağlayıcı, tarih.
 *  - Analiz geçmişi: GET /api/analysis (son 5 kayıt).
 *  - Hata durumunda yönlendirici mesaj (API key yoksa admin paneline).
 *  - 429 (cooldown): kalan süre mesajıyla tekrar deneme yönlendirmesi.
 */

/** Analiz kaydı görünümü — GET/POST /api/analysis öğesi. */
interface AnalysisItem {
  id: string;
  symbol: string;
  provider: string;
  model: string;
  action: AiAction;
  confidence: string;
  reasoning: string;
  risks: string | null;
  createdAt: string;
}

/** GET /api/analysis yanıt zarfı. */
interface AnalysisListResponse {
  analyses: AnalysisItem[];
  total: number;
}

/** Action badge renk eşlemesi. */
const ACTION_STYLES: Record<AiAction, { label: string; badge: string; bar: string }> = {
  BUY: {
    label: "AL",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    bar: "bg-emerald-500",
  },
  SELL: {
    label: "SAT",
    badge: "bg-rose-500/15 text-rose-400 border-rose-500/40",
    bar: "bg-rose-500",
  },
  HOLD: {
    label: "BEKLE",
    badge: "bg-gray-500/15 text-gray-300 border-gray-500/40",
    bar: "bg-gray-500",
  },
};

/** Riskler JSON string'ini güvenle parse eder. */
function parseRisks(risks: string | null): string[] {
  if (!risks) return [];
  try {
    const parsed: unknown = JSON.parse(risks);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

export function AiAnalysisSection({ symbol }: { symbol: string }) {
  const [analyses, setAnalyses] = useState<AnalysisItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Analiz geçmişini çeker. */
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/analysis?symbol=${symbol}&pageSize=5`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as AnalysisListResponse;
      setAnalyses(data.analyses);
      setTotal(data.total);
    } catch {
      // Geçmiş yükleme hatası sessizce yutulur — bölüm boş durumda kalır.
    } finally {
      setLoadingHistory(false);
    }
  }, [symbol]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  /** Yeni analiz tetikler. */
  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch(`/api/analysis?symbol=${symbol}`, {
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "string"
            ? ((payload as { error: string }).error)
            : "Analiz başarısız oldu.";
        setError(message);
        return;
      }
      // Başarılı yanıt: AnalysisItem olarak doğrula ve listeye ekle.
      if (typeof payload === "object" && payload !== null && "id" in payload) {
        const analysis = payload as AnalysisItem;
        setAnalyses((prev) => [analysis, ...prev].slice(0, 5));
        setTotal((t) => t + 1);
      }
    } catch {
      setError("Analiz servisine ulaşılamadı. Ağ bağlantınızı kontrol edin.");
    } finally {
      setAnalyzing(false);
    }
  }

  const latest = analyses[0] ?? null;
  const historyItems = analyses.slice(1);

  return (
    <section
      className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
      aria-label="AI Analizi"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          <BrainCircuit className="h-4 w-4 text-blue-400" aria-hidden />
          AI Analizi
        </h2>
        <button
          type="button"
          onClick={() => void handleAnalyze()}
          disabled={analyzing}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {analyzing ? "Analiz Ediliyor…" : "Analiz Et"}
        </button>
      </div>

      {error && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300"
          role="alert"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {analyzing && !latest && (
        <div className="mt-4 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          LLM analizi çalışıyor — bu işlem 30 saniyeye kadar sürebilir…
        </div>
      )}

      {/* Son analiz kartı */}
      {latest && (
        <article className="mt-4 rounded-lg border border-gray-700 bg-gray-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "rounded-md border px-3 py-1 text-sm font-bold",
                  ACTION_STYLES[latest.action].badge,
                )}
              >
                {ACTION_STYLES[latest.action].label}
              </span>
              <span className="text-xs text-gray-500">
                {formatDate(latest.createdAt)}
              </span>
            </div>
            <span className="rounded-md bg-gray-800 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {latest.provider} · {latest.model}
            </span>
          </div>

          {/* Confidence bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Güven Skoru</span>
              <span className="tabular-nums font-semibold text-gray-200">
                %{(Number(latest.confidence) * 100).toFixed(0)}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-800"
              role="progressbar"
              aria-valuenow={Math.round(Number(latest.confidence) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Güven skoru"
            >
              <div
                className={cn("h-full rounded-full", ACTION_STYLES[latest.action].bar)}
                style={{ width: `${Math.min(100, Math.max(0, Number(latest.confidence) * 100))}%` }}
              />
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-gray-300">
            {latest.reasoning}
          </p>

          {parseRisks(latest.risks).length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500">Öne Çıkan Riskler</p>
              <ul className="mt-1.5 space-y-1">
                {parseRisks(latest.risks).map((risk, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-xs text-gray-400">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gray-600" aria-hidden />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}

      {/* Analiz geçmişi */}
      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <History className="h-3.5 w-3.5" aria-hidden />
          Analiz Geçmişi {total > 0 && `(${total} kayıt)`}
        </p>
        {loadingHistory ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Yükleniyor…
          </div>
        ) : historyItems.length === 0 && !latest ? (
          <p className="mt-2 text-xs text-gray-500">
            Henüz analiz kaydı yok. "Analiz Et" ile ilk analizi tetikleyin.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-800/60">
            {historyItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-bold",
                      ACTION_STYLES[item.action].badge,
                    )}
                  >
                    {ACTION_STYLES[item.action].label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="tabular-nums">
                    %{(Number(item.confidence) * 100).toFixed(0)}
                  </span>
                  <span className="uppercase">{item.provider}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {total > 5 && (
          <p className="mt-2 flex items-center gap-1 text-[10px] text-gray-600">
            <ExternalLink className="h-3 w-3" aria-hidden />
            Son 5 analiz gösteriliyor
          </p>
        )}
      </div>
    </section>
  );
}
