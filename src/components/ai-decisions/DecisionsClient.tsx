"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

/**
 * AI Kararları ekranı — /ai-decisions (client kabuk).
 *
 * Kullanıcının tarifi:
 *  - Kayan akış (feed): otomatik alım-satım AI'ının kararları en yeniden
 *    eskiye, aşağı doğru kayar. Her kart: sembol + AL/SAT/TUT/SKIP rozeti,
 *    zaman, güven, "Araştırma" (collapsible), "Değerlendirme/Gerekçe",
 *    "İç Konuşma" (varsa), emir bilgisi, model+sağlayıcı.
 *  - Sohbet: feed'in altında geçmiş + EN ALTTA yazma kutusu. Kullanıcı
 *    soru yazar → POST /api/ai-decisions/ask → yanıt akışa eklenir.
 *  - "Daha fazla yükle" ile cursor sayfalama; 45 sn'de bir polling ile
 *    yeni kararlar feed başına eklenir.
 */

/** Karar kaydı görünümü — GET /api/ai-decisions öğesi (servis sözleşmesi). */
interface DecisionItem {
  id: string;
  jobRunId: string | null;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD" | "SKIP";
  research: string | null;
  reasoning: string | null;
  innerMonologue: string | null;
  confidence: number | null;
  orderPlaced: boolean;
  quantity: string | null;
  price: string | null;
  skipReason: string | null;
  model: string | null;
  provider: string | null;
  latencyMs: number | null;
  createdAt: string;
}

/** GET /api/ai-decisions yanıt zarfı. */
interface DecisionListResponse {
  decisions: DecisionItem[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/** Sohbet mesajı görünümü — GET /api/ai-decisions/chat öğesi. */
interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  model: string | null;
  provider: string | null;
  createdAt: string;
}

/** POST /api/ai-decisions/ask yanıtı. */
interface AskResponse {
  question: ChatMessage;
  answer: ChatMessage;
  contextCount: number;
}

/** Eylem rozeti eşlemesi — AL yeşil / SAT kırmızı / TUT gri / SKIP sarı. */
const ACTION_STYLES: Record<
  DecisionItem["action"],
  { label: string; badge: string; dot: string }
> = {
  BUY: {
    label: "AL",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    dot: "bg-emerald-500",
  },
  SELL: {
    label: "SAT",
    badge: "bg-rose-500/15 text-rose-400 border-rose-500/40",
    dot: "bg-rose-500",
  },
  HOLD: {
    label: "TUT",
    badge: "bg-gray-500/15 text-gray-300 border-gray-500/40",
    dot: "bg-gray-500",
  },
  SKIP: {
    label: "SKIP",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/40",
    dot: "bg-amber-500",
  },
};

/** Sayfa boyutu — "Daha fazla yükle" her seferinde bu kadar ekler. */
const PAGE_SIZE = 20;

/** Yeni karar polling aralığı (ms). */
const POLL_INTERVAL_MS = 45_000;

/** API yanıtından hata mesajını güvenle çıkarır. */
async function extractError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
    ) {
      return (payload as { error: string }).error;
    }
  } catch {
    // JSON olmayan yanıt — genel mesaja düş.
  }
  return `İstek başarısız oldu (HTTP ${response.status}).`;
}

/** Tek karar kartı — feed öğesi. */
function DecisionCard({ decision }: { decision: DecisionItem }) {
  const [researchOpen, setResearchOpen] = useState(false);
  const style = ACTION_STYLES[decision.action];

  return (
    <article
      className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
      aria-label={`${decision.symbol} kararı`}
    >
      {/* Başlık satırı: sembol + rozet + zaman + güven. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-bold",
              style.badge,
            )}
          >
            {style.label}
          </span>
          <span className="text-sm font-semibold text-gray-100">
            {decision.symbol}
          </span>
          <span className="text-xs text-gray-500">
            {formatDate(decision.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {decision.confidence !== null && (
            <span className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-medium tabular-nums text-gray-300">
              Güven %{decision.confidence}
            </span>
          )}
          {decision.latencyMs !== null && (
            <span className="text-[10px] tabular-nums text-gray-600">
              {(decision.latencyMs / 1000).toFixed(1)} sn
            </span>
          )}
        </div>
      </div>

      {/* Emir bilgisi (verildiyse) veya atlama nedeni. */}
      {decision.orderPlaced ? (
        <p className="mt-2 text-xs text-gray-400">
          <span className="font-medium text-gray-300">Emir verildi:</span>{" "}
          {decision.quantity ?? "?"} lot
          {decision.price !== null && ` @ ${decision.price} TL`}
        </p>
      ) : decision.skipReason ? (
        <p className="mt-2 text-xs text-amber-400/90">{decision.skipReason}</p>
      ) : null}

      {/* Değerlendirme/Gerekçe — kullanıcının ana isteği: neden aldı/sattı. */}
      {decision.reasoning && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <BrainCircuit className="h-3.5 w-3.5 text-blue-400" aria-hidden />
            Değerlendirme
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gray-300">
            {decision.reasoning}
          </p>
        </div>
      )}

      {/* Araştırma — collapsible (fiyat/haber/teknik bağlam). */}
      {decision.research && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setResearchOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-lg bg-gray-950/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 transition-colors hover:text-gray-300"
            aria-expanded={researchOpen}
          >
            <span>Araştırma</span>
            {researchOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          {researchOpen && (
            <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-950/80 p-3 text-[11px] leading-relaxed text-gray-400">
              {decision.research}
            </pre>
          )}
        </div>
      )}

      {/* İç konuşma — reasoning model çıktısı (varsa, italik/stilize). */}
      {decision.innerMonologue && (
        <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300/80">
            İç Konuşma
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs italic leading-relaxed text-indigo-200/80">
            {decision.innerMonologue}
          </p>
        </div>
      )}

      {/* Model + sağlayıcı rozeti. */}
      {(decision.model || decision.provider) && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-800/60 pt-2">
          <span className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {decision.provider ?? "?"} · {decision.model ?? "?"}
          </span>
        </div>
      )}
    </article>
  );
}

export function DecisionsClient() {
  // --- Feed durumu.
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // --- Sohbet durumu.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(true);

  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  /** Feed'in İLK sayfasını çeker (yenileme/polling dahil). */
  const fetchFirstPage = useCallback(async (silent: boolean): Promise<void> => {
    if (!silent) setLoadingFeed(true);
    try {
      const response = await fetch(`/api/ai-decisions?limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        if (!silent) setFeedError(await extractError(response));
        return;
      }
      const data = (await response.json()) as DecisionListResponse;
      setDecisions(data.decisions);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      setTotal(data.total);
      if (!silent) setFeedError(null);
    } catch {
      if (!silent) {
        setFeedError(
          "AI kararları yüklenemedi. Ağ bağlantınızı kontrol edin.",
        );
      }
    } finally {
      if (!silent) setLoadingFeed(false);
    }
  }, []);

  /** "Daha fazla yükle" — cursor'lu sonraki sayfa. */
  async function handleLoadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/ai-decisions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setFeedError(await extractError(response));
        return;
      }
      const data = (await response.json()) as DecisionListResponse;
      // Dedup: cursor kaydı silinip yeniden gelse de aynı id iki kez render edilmez.
      setDecisions((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        const fresh = data.decisions.filter((d) => !seen.has(d.id));
        return [...prev, ...fresh];
      });
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      setFeedError(null);
    } catch {
      setFeedError("Daha fazla karar yüklenemedi. Ağ bağlantınızı kontrol edin.");
    } finally {
      setLoadingMore(false);
    }
  }

  /** Sohbet geçmişini çeker (en yeniden eskiye — UI'da eskiden yeniye çevrilir). */
  const fetchChat = useCallback(async (): Promise<void> => {
    setLoadingChat(true);
    try {
      const response = await fetch("/api/ai-decisions/chat?limit=100", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { messages: ChatMessage[] };
      // API en yeniden eskiye döner; sohbet eskiden yeniye akar.
      setMessages(data.messages.slice().reverse());
    } catch {
      // Geçmiş yükleme hatası sessizce yutulur — sohbet boş durumda kalır.
    } finally {
      setLoadingChat(false);
    }
  }, []);

  useEffect(() => {
    void fetchFirstPage(false);
    void fetchChat();
  }, [fetchFirstPage, fetchChat]);

  /** Polling: 45 sn'de bir yeni kararları kontrol et (sessiz — spinner yok). */
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchFirstPage(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchFirstPage]);

  /** Sohbet yeni mesaj geldiğinde en alta kaydır. */
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, asking]);

  /** Kullanıcı sorusunu gönderir → AI yanıtı sohbete eklenir. */
  async function handleAsk(): Promise<void> {
    const trimmed = question.trim();
    if (trimmed.length < 3 || asking) return;
    setAsking(true);
    setChatError(null);
    // Soruyu hemen sohbete yansıt (optimistik — API kalıcı kaydı döndürür).
    const optimisticId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "USER",
        content: trimmed,
        model: null,
        provider: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setQuestion("");
    try {
      const response = await fetch("/api/ai-decisions/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setChatError(await extractError(response));
        return;
      }
      if (typeof payload === "object" && payload !== null && "answer" in payload) {
        const data = payload as AskResponse;
        // Optimistik soruyu kalıcı kayıtla değiştir + yanıtı ekle.
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          data.question,
          data.answer,
        ]);
      }
    } catch {
      setChatError(
        "Sorunuz gönderilemedi. Ağ bağlantınızı kontrol edin.",
      );
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ============ KAYAN AKIŞ (FEED) ============ */}
      <section
        className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
        aria-label="AI karar akışı"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            <Sparkles className="h-4 w-4 text-blue-400" aria-hidden />
            Karar Akışı
            {total > 0 && (
              <span className="text-[10px] font-medium normal-case text-gray-500">
                ({total} kayıt)
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => void fetchFirstPage(false)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loadingFeed && "animate-spin")}
              aria-hidden
            />
            Yenile
          </button>
        </div>

        {feedError && (
          <div
            className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300"
            role="alert"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{feedError}</span>
          </div>
        )}

        {loadingFeed ? (
          <div className="mt-4 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            AI kararları yükleniyor…
          </div>
        ) : decisions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
            Henüz AI karar kaydı yok. Otomatik alım-satım motoru çalıştığında
            kararlar burada görünecek.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {decisions.map((decision) => (
              <DecisionCard key={decision.id} decision={decision} />
            ))}
          </div>
        )}

        {hasMore && !loadingFeed && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Yükleniyor…
                </span>
              ) : (
                "Daha fazla yükle"
              )}
            </button>
          </div>
        )}
      </section>

      {/* ============ SOHBET ============ */}
      <section
        className="rounded-xl border border-gray-800 bg-gray-900/60 p-5"
        aria-label="AI sohbeti"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          <MessageCircleQuestion className="h-4 w-4 text-blue-400" aria-hidden />
          AI'ya Sor
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Otomatik alım-satım kararları hakkında yapay zekâya soru sorun —
          yanıtlar son kararlarınızı bağlam olarak kullanır.
        </p>

        {chatError && (
          <div
            className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300"
            role="alert"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{chatError}</span>
          </div>
        )}

        {/* Sohbet geçmişi — eskiden yeniye, en altta yazma kutusu. */}
        <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
          {loadingChat ? (
            <div className="flex items-center justify-center py-6 text-xs text-gray-500">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
              Sohbet geçmişi yükleniyor…
            </div>
          ) : messages.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500">
              Henüz sohbet yok. İlk sorunuzu aşağıdaki kutuya yazın.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "USER" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                    message.role === "USER"
                      ? "bg-blue-600 text-white"
                      : "border border-gray-700 bg-gray-950/70 text-gray-200",
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.role === "ASSISTANT" && (message.model || message.provider) && (
                    <p className="mt-1.5 text-[10px] uppercase tracking-wide text-gray-500">
                      {message.provider ?? "?"} · {message.model ?? "?"} ·{" "}
                      {formatDate(message.createdAt)}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}

          {/* "AI düşünüyor..." göstergesi. */}
          {asking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/70 px-3.5 py-2.5 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                AI düşünüyor…
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* EN ALTTA yazma kutusu. */}
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAsk();
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter gönderir, Shift+Enter alt satır açar.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleAsk();
              }
            }}
            placeholder="Örn: THYAO'yu neden sattın?"
            rows={2}
            maxLength={2000}
            disabled={asking}
            className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            aria-label="Soru kutusu"
          />
          <button
            type="submit"
            disabled={asking || question.trim().length < 3}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Soruyu gönder"
          >
            {asking ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
