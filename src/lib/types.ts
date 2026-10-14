/**
 * Paylaşılan TypeScript tipleri — platform genelinde tek doğruluk kaynağı.
 *
 * Not: Geliştirme veri tabanı SQLite olduğu için Prisma şemasında native
 * enum kullanılmaz; enum değerleri `String` sütunlarda saklanır ve bu dosyadaki
 * union tiplerle tip güvenliği sağlanır. Üretimde PostgreSQL'e geçildiğinde
 * aynı union'lar Prisma enum'larıyla birebir eşleşir (Bölüm 4.1).
 */

/** Ticaret modu — AdminSettings.tradingMode ile birebir eşleşir. */
export type TradingMode = "PAPER" | "LIVE";

/** Emir yönü — LLM action çıktısı ve emir tarafında ortaktır. */
export type OrderSide = "BUY" | "SELL";

/** Emir durum makinesi — Bölüm 3.5'teki geçiş kurallarına tabidir. */
export type OrderStatus =
  | "PENDING"
  | "EXECUTING"
  | "FILLED"
  | "REJECTED"
  | "FAILED"
  | "PENDING_RECONCILIATION"
  | "CANCELLED";

/** Emir kaynağı: insan mı, otomatik motor mu, risk kuralı mı üretti. */
export type OrderSource = "MANUAL" | "AUTO_ENGINE" | "RISK_RULE";

/** Platformda işlem gören varlık türleri. */
export type AssetType = "STOCK" | "CURRENCY";

/** LLM analiz kararı — StructuredAnalysis.action sözleşmesi. */
export type AiAction = "BUY" | "SELL" | "HOLD";

/**
 * Desteklenen AI sağlayıcılar — AdminSettings.aiProvider.
 *
 *  - GEMINI / OPENAI: doğrudan SDK implementasyonları.
 *  - ANTHROPIC: Anthropic Messages API (@anthropic-ai/sdk).
 *  - DEEPSEEK / GROK / MISTRAL: OpenAI-uyumlu bulut API'ler
 *    (openai-compatible-provider üzerinden).
 *  - CUSTOM: local AI (Ollama, LM Studio, vLLM vb.) — OpenAI-uyumlu
 *    base URL + opsiyonel API key + serbest model adı.
 */
export type AiProvider =
  | "GEMINI"
  | "OPENAI"
  | "ANTHROPIC"
  | "DEEPSEEK"
  | "GROK"
  | "MISTRAL"
  | "NVIDIA"
  | "CUSTOM";

/** Para birimleri — DenizBank TransactionType değerleriyle uyumlu. */
export type CurrencyCode =
  | "TRY"
  | "USD"
  | "EUR"
  | "GBP"
  | "CHF"
  | "JPY"
  | "AUD"
  | "CAD";

/** DenizBank hata sınıflandırması — Bölüm 2.3 retry politikası. */
export type DenizBankErrorClass =
  | "TRANSIENT"
  | "PERMANENT"
  | "DEFERRED"
  | "UNKNOWN";

/** Fiyat geçmişi dönemleri — grafikler ve LLM girdisi için. */
export type HistoryRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";

/** Haber kaynakları — AdminSettings.newsSources'ta referans edilir. */
export type NewsSourceId = "GOOGLE_NEWS" | "BIGPARA" | "CUSTOM_RSS";

/** Fiyat kaynağı türü — AdminSettings.priceSource (Strategy Pattern anahtarı). */
export type PriceSourceKind = "YAHOO" | "SIMULATED";

/**
 * Otomatik alım-satım onay modu — AdminSettings.autoTradeApprovalMode.
 *  - MANUAL: motor emirleri admin onayı bekler (PendingOrder kaydı oluşur).
 *  - AUTO: motor emirleri insan onayı olmadan doğrudan uygulanır.
 */
export type AutoTradeApprovalMode = "MANUAL" | "AUTO";

/** Fiyat kaynağı durumu — UI rozetleri ve fallback bilgilendirmesi için. */
export interface PriceSourceStatus {
  /** Ayarlardan seçili kaynak. */
  selected: PriceSourceKind;
  /** Fiilen kullanılan kaynak (Yahoo başarısızsa SIMULATED'a düşer). */
  effective: PriceSourceKind;
  /** Yahoo çağrısı başarısız olup simüle veriye mi düşüldü? */
  fallbackUsed: boolean;
  /** Fallback nedeni (hata mesajı — UI tooltip). */
  fallbackReason: string | null;
}

/** Haber makalesinin duygu sonucu (LLM analizinden). */
export type NewsSentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

/** Haber önem seviyesi — NewsArticle.importanceLevel (null: normal önem düzeyi). */
export type NewsImportanceLevel = "IMPORTANT" | "CRITICAL";

/** Hesap türü — sanal (paper) veya banka (live) hesabı. */
export type AccountType = "PAPER" | "LIVE";

/** Cron görev türleri — JobRun tablosunda izlenir (ADR-10). */
export type JobType =
  | "FETCH_PRICES"
  | "SCAN_NEWS"
  | "RUN_ANALYSIS"
  | "CHECK_ORDERS"
  | "RECONCILIATION"
  | "SYNC_BALANCE"
  | "AUTO_TRADE_CYCLE"
  | "SYNC_BIST100";

/** Cron görev sonucu. */
export type JobStatus = "RUNNING" | "SUCCESS" | "FAILED";

/** Admin panelinde sunucudan client'a taşınan maskeli ayar görünümü. */
export interface AdminSettingsView {
  id: string;
  tradingMode: TradingMode;
  liveModeConfirmedAt: string | null;
  aiProvider: AiProvider;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  geminiApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  openaiApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  anthropicApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  deepseekApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  grokApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  mistralApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür. */
  nvidiaApiKeyMasked: string;
  /** Maskeli — yalnızca son 4 karakter görünür (local AI'da genellikle boş). */
  customApiKeyMasked: string;
  /** Local/custom sağlayıcı OpenAI-uyumlu base URL (örn. http://localhost:11434/v1). */
  customBaseUrl: string | null;
  /** Local/custom sağlayıcı model adı (örn. llama3.2). */
  customModel: string;
  geminiModel: string;
  openaiModel: string;
  anthropicModel: string;
  deepseekModel: string;
  grokModel: string;
  mistralModel: string;
  nvidiaModel: string;
  systemPrompt: string;
  newsScanPrompt: string;
  stopLossPercent: number;
  takeProfitPercent: number;
  minConfidenceThreshold: number;
  maxPositionValue: number;
  maxOpenPositions: number;
  dailyOrderBudget: number;
  cooldownMinutes: number;
  /** Faz 5: otomatik alım-satım motoru anahtarı. */
  autoTradingEnabled: boolean;
  /** Faz 5: otomatik döngü aralığı (saniye). */
  autoTradeIntervalSeconds: number;
  /** Otomatik emir onay modu: MANUAL (admin onayı bekler) | AUTO (doğrudan uygular). */
  autoTradeApprovalMode: AutoTradeApprovalMode;
  /** Günlük maksimum zarar limiti (TL). */
  maxDailyLossLimit: number;
  /** Otomatik alım emirleri için maksimum tutar (TL). */
  maxBuyAmount: number;
  /** Otomatik satım emirleri için maksimum tutar (TL). */
  maxSellAmount: number;
  /** Fiyat kaynağı: YAHOO (gerçek) | SIMULATED (yedek). */
  priceSource: PriceSourceKind;
  newsSources: NewsSourceId[];
  updatedAt: string;
}

/** Admin ayarları güncelleme isteği — tüm alanlar opsiyonel (kısmi güncelleme). */
export interface AdminSettingsUpdateInput {
  tradingMode?: TradingMode;
  aiProvider?: AiProvider;
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  grokApiKey?: string;
  mistralApiKey?: string;
  nvidiaApiKey?: string;
  /** Local/custom API key — boş string = temizle; undefined = dokunulmaz. */
  customApiKey?: string;
  /** Local/custom OpenAI-uyumlu base URL — boş string = temizle. */
  customBaseUrl?: string;
  /** Local/custom model adı (serbest metin). */
  customModel?: string;
  geminiModel?: string;
  openaiModel?: string;
  anthropicModel?: string;
  deepseekModel?: string;
  grokModel?: string;
  mistralModel?: string;
  nvidiaModel?: string;
  systemPrompt?: string;
  newsScanPrompt?: string;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  minConfidenceThreshold?: number;
  maxPositionValue?: number;
  maxOpenPositions?: number;
  dailyOrderBudget?: number;
  cooldownMinutes?: number;
  autoTradingEnabled?: boolean;
  autoTradeIntervalSeconds?: number;
  autoTradeApprovalMode?: AutoTradeApprovalMode;
  maxDailyLossLimit?: number;
  maxBuyAmount?: number;
  maxSellAmount?: number;
  priceSource?: PriceSourceKind;
  newsSources?: NewsSourceId[];
}

// ============================================================
// FAZ 3 — PİYASA VERİSİ (fiyat akışı, grafik, izleme listesi)
// ============================================================

/** Lightweight Charts uyumlu OHLC mumu — {time, open, high, low, close}. */
export interface ChartCandle {
  /** UNIX zaman damgası (saniye) — lightweight-charts Time sözleşmesi. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** İzleme listesi fiyat görünümü — GET /api/market/prices öğesi. */
export interface WatchlistPriceView {
  stockId: string;
  symbol: string;
  name: string;
  /** Kayıt kaynağı: BIST100 (otomatik senkron) | MANUAL (kullanıcı ekledi). */
  source: "BIST100" | "MANUAL";
  /** Son fiyat (TL) — string serileştirme (ADR-8). */
  lastPrice: string | null;
  /** Günün ilk fiyatı (açılış referansı) — string serileştirme. */
  dayOpen: string | null;
  /** Mutlak değişim (TL) — dayOpen'e göre. */
  change: string | null;
  /** Yüzde değişim — dayOpen'e göre. */
  changePercent: string | null;
  /** Son fiyatın görüldüğü an (ISO). */
  updatedAt: string | null;
}

/** Hisse detay istatistikleri — /stock/[symbol] kartları. */
export interface StockStats {
  /** Dönemin en yüksek fiyatı. */
  high: string | null;
  /** Dönemin en düşük fiyatı. */
  low: string | null;
  /** Dönem ortalama kapanış fiyatı. */
  average: string | null;
  /** Dönemdeki fiyat örnekleme sayısı. */
  sampleCount: number;
}

/** Hisse detay sayfası görünümü — server → client props. */
export interface StockDetailView {
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  lastPrice: string | null;
  change: string | null;
  changePercent: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  updatedAt: string | null;
  inWatchlist: boolean;
}

/** Grafik geçmişi API yanıtı — GET /api/market/history. */
export interface HistoryResponse {
  symbol: string;
  range: HistoryRange;
  candles: ChartCandle[];
  /** Fiyat kaynağı durumu (gerçek/simüle + fallback bilgisi). */
  source: PriceSourceStatus;
}

/** Tick API yanıtı — POST /api/market/tick. */
export interface TickResultView {
  /** Tick'in işlediği hisse sayısı. */
  processed: number;
  /** Yeni fiyatlar {sembol: fiyat} haritası (string Decimal). */
  prices: Record<string, string>;
  /** Tick anı (ISO). */
  tickedAt: string;
  /** Kullanılan fiyat kaynağı durumu. */
  source: PriceSourceStatus;
}

/** İzleme listesi fiyatları API yanıtı — GET /api/market/prices. */
export interface WatchlistPricesResponse {
  prices: WatchlistPriceView[];
  /** Fiyat kaynağı durumu (gerçek/simüle + fallback bilgisi). */
  source: PriceSourceStatus;
}

/** BIST 100 otomatik senkron durumu — GET /api/watchlist/sync-bist100 ve UI. */
export interface Bist100SyncStatus {
  /** Senkron şu an çalışıyor mu? (çakışma koruması göstergesi). */
  isSyncing: boolean;
  /** Son BAŞARILI senkron zamanı (ISO) — hiç çalışmadıysa null. */
  lastSyncedAt: string | null;
  /** Son başarılı senkronda kaynaktan çekilen bileşen sayısı. */
  lastFetchedCount: number | null;
  /** Son başarılı senkronda izleme listesine YENİ eklenen bileşen sayısı. */
  lastAddedCount: number | null;
  /** Son senkron hatası mesajı (son deneme başarılıysa null). */
  lastError: string | null;
}

// ============================================================
// BEKLEYEN EMİRLER (admin onay akışı — PendingOrder)
// ============================================================

/** Bekleyen emir onay durumu — PendingOrder.status. */
export type PendingOrderStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Bekleyen emir taslağı — PendingOrder.orderData JSON gövdesi. */
export interface PendingOrderData {
  /** Emir yönü. */
  side: OrderSide;
  /** Hedef sembol (BIST hissesi veya döviz kodu). */
  symbol: string;
  /** Emir miktarı (hisse adedi veya döviz tutarı) — string serileştirme (ADR-8). */
  quantity: string;
  /** Referans fiyat (TL) — string serileştirme (ADR-8). */
  price: string;
  /** Emir para birimi. */
  currency: string;
  /** Emri üreten AI karar kaydı (izlenebilirlik). */
  decisionLogId?: string;
  /** Emri üreten AI analiz kaydı (izlenebilirlik). */
  analysisLogId?: string;
}

/** Bekleyen emir görünümü — admin onay ekranı liste öğesi (server → client). */
export interface PendingOrderView {
  id: string;
  orderData: PendingOrderData;
  status: PendingOrderStatus;
  reason: string | null;
  createdAt: string;
}
