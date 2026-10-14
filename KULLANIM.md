# BorsaRobot — Kullanım Kılavuzu

AI destekli borsa takip, haber analizi ve otomatik alım-satım platformunun uçtan uca kullanıcı rehberi. Bu kılavuz; ürünün nasıl çalıştığını, her sayfa ve menünün ne işe yaradığını, tüm ayarların anlamını ve güvenli kullanım adımlarını açıklar.

> Teknik mimari, ADR'ler ve sözleşme analizi için [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); kurulum özeti için [`README.md`](README.md) belgelerine bakın.

---

## İçindekiler

1. [Ürün Ne Yapıyor?](#1-ürün-ne-yapıyor)
2. [Hızlı Başlangıç](#2-hızlı-başlangıç)
3. [Sayfa Rehberi](#3-sayfa-rehberi)
   - [Ana Sayfa (/)](#31-ana-sayfa-)
   - [İzleme Listesi (/watchlist)](#32-izleme-listesi-watchlist)
   - [Hisse Detayı (/stock/sembol)](#33-hisse-detayı-stocksembol)
   - [Ticaret Paneli (/trading)](#34-ticaret-paneli-trading)
   - [Yönetim Paneli (/admin)](#35-yönetim-paneli-admin)
4. [Yönetim Paneli Ayarları — Alan Alan](#4-yönetim-paneli-ayarları--alan-alan)
5. [Otomatik Alım-Satım Motoru Nasıl Çalışır?](#5-otomatik-alım-satım-motoru-nasıl-çalışır)
6. [Sanal (PAPER) ve Canlı (LIVE) Mod](#6-sanal-paper-ve-canlı-live-mod)
7. [Haber Akışı ve AI Analizi](#7-haber-akışı-ve-ai-analizi)
8. [Sık Sorulan Sorular ve Sorun Giderme](#8-sık-sorulan-sorular-ve-sorun-giderme)

---

## 1. Ürün Ne Yapıyor?

BorsaRobot, Borsa İstanbul hisselerini takip eden **çift modlu** (Sanal/Canlı) bir ticaret asistanıdır. Çalışma döngüsü şu şekildedir:

```
Piyasa fiyatı üretilir (simülasyon)
        ↓
Google News RSS'ten sembol bazlı haber çekilir
        ↓
Haberler + fiyat geçmişi + pozisyon bilgisi LLM'e (Gemini/OpenAI) gönderilir
        ↓
LLM yapılandırılmış JSON karar üretir: BUY / SELL / HOLD + güven skoru
        ↓
Otomatik motor (etkinse) kararı risk kurallarından geçirip emre çevirir
        ↓
PAPER modda: sanal bakiye ile simüle edilir
LIVE modda: DenizBank API Market üzerinden gerçek döviz işlemi yapılır
```

Önemli mimari özellikler:

- **Fiyatlar simüle edilir**: Gerçek borsa verisi yerine deterministik, seed'li bir piyasa simülatörü çalışır ([`market-simulator.ts`](src/server/services/market-simulator.ts)). Her "tick"te fiyatlar değişir ve OHLC mum grafikleri üretilir.
- **Haberler gerçek**: Google News RSS üzerinden gerçek haber başlıkları çekilir; aynı URL iki kez kaydedilmez (SHA-256 `urlHash` dedup).
- **AI analizi yapılandırılmış**: LLM yanıtları Zod şemasıyla doğrulanır; geçersiz yanıtlarda hata geri beslemeli retry çalışır.
- **Canlı mod kasıtlı olarak çok katmanlıdır**: Yanlışlıkla gerçek para harcanmasını önlemek için birden fazla onay katmanı vardır (bkz. [Bölüm 6](#6-sanal-paper-ve-canlı-live-mod)).

---

## 2. Hızlı Başlangıç

Gereksinimler: Node.js ≥ 18.18 ve npm.

```bash
# 1) Bağımlılıkları kur
npm install

# 2) Ortam değişkenlerini hazırla
cp .env.example .env

# 3) Veri tabanını kur (şema + örnek veriler)
npm run db:generate   # Prisma client üret
npm run db:push       # SQLite şemasını uygula
npm run db:seed       # Örnek hisseleri ve varsayılan ayarları yükle

# 4) Uygulamayı başlat
npm run dev           # http://localhost:3000
```

İlk kurulumdan sonra tarayıcıda <http://localhost:3000> adresini açın. Seed, izleme listenize birkaç BIST hissesi (THYAO, ASELS, GARAN vb.) ve sanal hesabınıza bakiye yükler — hemen kullanmaya başlayabilirsiniz.

**AI analizi kullanmak istiyorsanız** (opsiyonel ama önerilir): `/admin` → *AI Ayarları* sekmesinden Gemini veya OpenAI API anahtarınızı girin. Anahtar girilmeden de fiyat takibi, izleme listesi ve sanal emirler çalışır; ancak AI analizi ve otomatik motor anahtar gerektirir.

**Komut satırı doğrulaması** (her şeyin sağlıklı olduğunu kontrol etmek için):

```bash
npm run verify:all    # 7 doğrulama script'i, 101 kontrol — hepsi mock modda koşar
```

---

## 3. Sayfa Rehberi

Uygulamanın üst navigasyon çubuğunda 5 ana bölüm vardır. Her birinin işlevi aşağıda ayrıntılı açıklanmıştır.

### 3.1 Ana Sayfa (/)

Genel bakış panosudur ([`page.tsx`](src/app/page.tsx)). İçerdiği kartlar:

| Kart | Anlamı |
| --- | --- |
| **Takip Edilen Hisseler** | Veri tabanında kayıtlı toplam BIST hissesi sayısı |
| **İzleme Listesi** | Aktif takip listenizdeki sembol sayısı |
| **Toplam Varlık** | Sanal nakit bakiye + açık pozisyonların güncel değeri (alt ipucunda nakit ve pozisyon adedi gösterilir) |
| **Toplam K/Z** | Gerçekleşen + açık pozisyon kâr/zararı; yeşil (pozitif), kırmızı (negatif) veya nötr renk kodludur |

Sayfanın altında **yükselenler ve düşenler** listeleri bulunur: izleme listenizdeki hisseler günlük değişim yüzdesine göre sıralanır, en çok yükselen 5 ve en çok düşen 5 sembol gösterilir. Her satır tıklanabilir ve doğrudan hisse detay sayfasına götürür.

### 3.2 İzleme Listesi (/watchlist)

Takip ettiğiniz hisselerin canlı fiyat tablosudur ([`WatchlistClient.tsx`](src/components/watchlist/WatchlistClient.tsx)). Davranışı:

- **Otomatik yenileme**: Her 10 saniyede bir fiyatlar arka planda yeniden çekilir; sayfayı elle yenilemeniz gerekmez.
- **"Şimdi Yenile" düğmesi**: Yeni bir piyasa tick'i üretir (fiyatlar değişir) ve tabloyu tazeler. Fiyatlar yalnızca tick ile değiştiğinden, yeni fiyat görmek istediğinizde bu düğmeyi kullanın.
- **Sembol ekleme**: Üstteki giriş alanına 3–5 harfli BIST sembolü yazıp ekleyin (örn. `THYAO`). Sembol veri tabanında kayıtlı olmalıdır.
- **Çıkarma**: Satır sonundaki çöp kutusu simgesi sembolü listeden kaldırır (hisse kaydı silinmez, yalnızca takipten düşer).
- **Satır tıklama**: Hisse detay sayfasını açar.
- **Mini grafik (sparkline)**: Her satırda son fiyat örneklemesinden üretilen küçük bir SVG trend çizgisi vardır; yeşil yükseliş, kırmızı düşüşü gösterir.

### 3.3 Hisse Detayı (/stock/sembol)

Tek hissenin derinlemesine analiz sayfasıdır ([`StockDetailClient.tsx`](src/components/stock/StockDetailClient.tsx)). Bölümleri:

- **Fiyat grafiği**: TradingView Lightweight Charts ile mum (candlestick) grafiği. Dönem seçici: **1G / 1H / 1A / 3A / 1Y**. Grafik üzerinde imleci gezdirdiğinizde o mumun Açılış/Yüksek/Düşük/Kapanış (OHLC) değerleri tooltip'te görünür. Grafik her 10 saniyede bir son mumı günceller.
- **İstatistikler**: Seçili dönem için ortalama fiyat, en yüksek/en düşük, değişim yüzdesi gibi özet metrikler.
- **AI Analizi bölümü**: "Analiz Et" ile LLM'den o anki karar istenir. Yanıt şunları içerir:
  - **Karar**: BUY (al) / SELL (sat) / HOLD (bekle)
  - **Güven skoru**: 0.0–1.0 arası modelin kendinden eminlik derecesi
  - **Gerekçe**: En fazla 3 cümlelik Türkçe açıklama
  - **Riskler**: En fazla 5 maddelik risk listesi
  - Analizin hangi haberler ve fiyat verisiyle yapıldığı da gösterilir; her analiz `AiAnalysisLog` tablosuna geçmiş için kaydedilir.
- **Haberler bölümü**: O hisseyle eşleşen son haberler; başlık, kaynak, özet ve tarih. "Haber Tara" düğmesi Google News'ten yeni tarama yapar.
- **Hızlı Al / Hızlı Sat düğmeleri**: Sizi doğrudan `/trading` sayfasındaki emir formuna götürür ve sembol + yön (al/sat) hazır gelir.

### 3.4 Ticaret Paneli (/trading)

Emir verme, portföy ve geçmiş görünümünün birleşik panosudur ([`TradingDashboard.tsx`](src/components/trading/TradingDashboard.tsx)). Bölümleri:

- **Hesap Özeti** ([`AccountSummary.tsx`](src/components/trading/AccountSummary.tsx)): Nakit bakiye, toplam varlık, toplam K/Z, açık pozisyon sayısı ve aktif çalışma modu (PAPER/LIVE).
- **Pozisyonlar tablosu** ([`PortfolioTable.tsx`](src/components/trading/PortfolioTable.tsx)): Açık pozisyonlar — sembol, lot adedi, ortama maliyet, güncel fiyat, pozisyon değeri ve açık K/Z. Satırdaki "Sat" kısayolu emir formunu doldurur.
- **Hızlı Emir formu** ([`OrderForm.tsx`](src/components/trading/OrderForm.tsx)):
  1. **Sembol**: İzleme listenizden açılır listeden seçilir.
  2. **Yön**: AL (yeşil) / SAT (kırmızı) düğmeleri.
  3. **Miktar**: Tamsayı lot adedi.
  4. **Tahmini tutar**: Seçim yaptıkça canlı hesaplanır — fiyat × adet + komisyon. PAPER modda komisyon uygulanır; LIVE döviz işlemlerinde komisyon yoktur.
  5. **Gönder**: Emir anında eşleşir (FILLED) veya reddedilir (REJECTED — örn. yetersiz bakiye) ve sonuç mesajı gösterilir. Her gönderimde benzersiz bir `clientRequestId` üretilir; aynı istek sunucuya iki kez düşerse ikincisi yeni emir açmaz (idempotency koruması).
  - **LIVE modda ekstra adım**: Formda kırmızı "CANLI İŞLEM" uyarı kutusu görünür; kutuyu onaylamadan gönder düğmesi etkinleşmez ve onay her emirden sonra sıfırlanır — her canlı emir için bilinçli, ayrı onay gerekir.
- **Emir Geçmişi** ([`OrderHistoryTable.tsx`](src/components/trading/OrderHistoryTable.tsx)): Tüm emirler — zaman, sembol, yön, miktar, gerçekleşen fiyat, durum (FILLED/REJECTED), kaynak (MANUAL = siz, AUTO_ENGINE = otomatik motor) ve varsa K/Z.
- **Otomatik Motor Durum Kartı** ([`AutoTradeStatusCard.tsx`](src/components/trading/AutoTradeStatusCard.tsx)): Motorun açık/kapalı olduğunu, döngü aralığını, son döngünün sonucunu (kaç pozisyon tarandı, kaç emir verildi, atlanma nedeni) gösterir. Burası **yalnızca izleme** amaçlıdır; motoru açıp kapatmak admin panelinden yapılır.

### 3.5 Yönetim Paneli (/admin)

Tüm sistem yapılandırmasının yapıldığı bölümdür ([`SettingsForm.tsx`](src/components/admin/SettingsForm.tsx)). Üç sekmeden oluşur:

1. **AI Ayarları** — sağlayıcı, anahtar, model, haber kaynakları
2. **Promptlar** — LLM'e gönderilen sistem talimatlarının düzenlenmesi
3. **Risk & Mod** — çalışma modu, otomatik motor anahtarı, risk parametreleri

Her bölüm kendi "Kaydet" düğmesine sahiptir; kaydedilen değerler anında etkinleşir (sunucu yeniden başlatma gerekmez). Ayrıntılı alan açıklamaları için [Bölüm 4](#4-yönetim-paneli-ayarları--alan-alan)'e bakın.

---

## 4. Yönetim Paneli Ayarları — Alan Alan

### 4.1 AI Ayarları Sekmesi ([`AiProviderSelector.tsx`](src/components/admin/AiProviderSelector.tsx))

| Alan | Açıklama |
| --- | --- |
| **AI Sağlayıcı** | `GEMINI` (Google) veya `OPENAI` seçilir. Tüm analiz istekleri seçilen sağlayıcıya gider. |
| **API Anahtarı** | Seçilen sağlayıcının anahtarı. Anahtar veri tabanında saklanır, koda gömülmez. Alan boş bırakılıp kaydedilirse anahtar temizlenir. |
| **Model** | Sağlayıcıya göre açılır liste: Gemini için `gemini-2.0-flash` (hızlı/ekonomik), `gemini-2.0-flash-lite` (en ekonomik), `gemini-1.5-flash`, `gemini-1.5-pro` (en yetenekli); OpenAI için `gpt-4o` (dengeli, önerilen), `gpt-4o-mini` (ekonomik), `gpt-4.1`, `gpt-4.1-mini`. |
| **Haber Kaynakları** | Çoklu seçim: Google News (varsayılan, RSS taraması), BigPara, Özel RSS. En az bir kaynak seçili olmalıdır. |
| **"AI Bağlantısını Test Et"** | Girilen anahtar ve modelle küçük bir test isteği atar; anahtarın geçerliliğini kaydetmeden doğrulamanızı sağlar. |

### 4.2 Promptlar Sekmesi ([`PromptEditor.tsx`](src/components/admin/PromptEditor.tsx))

Bu sekmede LLM'e gönderilen iki talimat metni düzenlenir. Metinler Türkçe yazılabilir; ancak **yanıt formatı kuralları bozulmamalıdır** — sistem yanıtı JSON olarak ayrıştırmaya çalışır.

| Alan | Ne İçin Kullanılır | Dikkat Edilmesi Gereken |
| --- | --- | --- |
| **Sistem Promptu** | Hisse analiz kararlarını üreten ana talimat. Modele hisse, haberler, fiyat geçmişi ve pozisyon bilgisiyle birlikte gönderilir. | Yanıtın `{"action": "BUY\|SELL\|HOLD", "confidence": 0.0-1.0, "reasoning": "...", "risks": ["..."]}` JSON yapısında isteyen kural metni korunmalıdır. |
| **Haber Tarama Promptu** | Günlük haber akışını hisselerle eşleştiren ve duygu sınıflandıran talimat. | `{"articles": [...]}` JSON yapısı kuralı korunmalıdır. |

Varsayılan metinler [`constants.ts`](src/lib/constants.ts) içinde tanımlıdır (`DEFAULT_SYSTEM_PROMPT`, `DEFAULT_NEWS_SCAN_PROMPT`). Bozarsanız varsayılana dönmek için bu dosyadaki metinleri kopyalayabilirsiniz.

### 4.3 Risk & Mod Sekmesi

Bu sekmede üç ayrı kart bulunur:

#### A) Çalışma Modu Kartı ([`ModeSwitch.tsx`](src/components/admin/ModeSwitch.tsx))

- **Sanal (Paper Trading)**: Emirler sanal bakiye ile simüle edilir; komisyon uygulanır; gerçek para hareketi olmaz. Güvenli deneme modu.
- **Canlı (Live Trading)**: Emirler DenizBank API Market üzerinden **gerçek para hareketi** üretir. LIVE'a geçerken risk parametrelerini gösteren zorunlu onay diyaloğu açılır; onay `liveModeConfirmedAt` damgasını yazar ve bu damga olmadan hiçbir canlı emir sunucuda kabul edilmez.
- **"DenizBank Bağlantısını Test Et"**: Bankaya `GetAccountList` isteği atar; AppKey ve temel adresin doğruluğunu, hesap listesinin dönüp dönmediğini gösterir. Mock modda çalışıyorsa yanıtta `mockMode: true` belirtilir.
- LIVE seçiliyken kartın altında kırmızı bir uyarı bandı ve onay damgasının zamanı gösterilir.

#### B) Otomatik Ticaret Kartı ([`AutoTradeSettingsForm.tsx`](src/components/admin/AutoTradeSettingsForm.tsx))

| Alan | Açıklama | Sınır | Varsayılan |
| --- | --- | --- | --- |
| **Otomatik Alım-Satım Anahtarı** | Motoru açar/kapatır. Açıkken scheduler her döngüde izleme listesindeki hisseleri tarar. | — | Kapalı |
| **Döngü Aralığı (sn)** | İki otomatik döngü arasındaki süre. | 10–3600 sn | 60 sn |

#### C) Risk Parametreleri Kartı ([`RiskSettingsForm.tsx`](src/components/admin/RiskSettingsForm.tsx))

Bu parametreler hem otomatik motoru hem de genel risk davranışını kontrol eder:

| Alan | Ne Yapar | Sınır | Varsayılan |
| --- | --- | --- | --- |
| **Stop-Loss (%)** | Açık pozisyon, ortama maliyetin bu yüzdesi kadar düştüyse otomatik satılır. | 0.5–50 | %5 |
| **Take-Profit (%)** | Pozisyon, maliyetin bu yüzdesi kadar yükseldiyse otomatik satılır (kâr realizasyonu). | 0.5–100 | %10 |
| **Min. Güven Eşiği** | AI kararı BUY/SELL olsa bile güven skoru bu eşiğin altındaysa otomatik emir verilmez. | 0–1 | 0.7 |
| **Maks. Pozisyon Değeri (TL)** | Tek bir hissedeki pozisyonun tavan değeri; aşan alım emirleri reddedilir. | 1.000–10.000.000 | 50.000 |
| **Maks. Açık Pozisyon** | Aynı anda taşınabilecek farklı hisse sayısı üst sınırı. | 1–50 | 5 |
| **Günlük Emir Bütçesi (TL)** | Bir günde verilebilecek toplam emir tutarı; aşımında günün kalanı için emir durdurulur. | 1.000–100.000.000 | 100.000 |
| **Cooldown (dk)** | Aynı hisse için iki otomatik işlem arasındaki zorunlu bekleme süresi (fazla alım-satımı önler). | 0–1440 | 60 dk |

Sınırlar [`RISK_LIMITS`](src/lib/constants.ts:88) sabitinde tanımlıdır ve formda geçersiz değer girilirse hem istemci hem sunucu tarafında reddedilir.

---

## 5. Otomatik Alım-Satım Motoru Nasıl Çalışır

Motor, [`scheduler.ts`](src/server/services/scheduler.ts) içindeki zamanlayıcı ile sunucu başladığında devreye girer ve [`auto-trade-service.ts`](src/server/services/auto-trade-service.ts) içindeki döngüyü çalıştırır. Adım adım:

1. **Zamanlayıcı**: Uygulama ayağa kalkarken `instrumentation.ts` aracılığıyla başlar. Döngü aralığı admin panelindeki ayardan okunur (varsayılan 60 sn). `AUTO_TRADE_SCHEDULER_DISABLED=1` ortam değişkeniyle tamamen kapatılabilir.
2. **Döngü başına yapılan işler**:
   - **Mod kontrolü**: `tradingMode` PAPER değilse döngü güvenlik gereği atlanır — canlı modda otomatik emir **asla** verilmez.
   - **Motor anahtarı kontrolü**: `autoTradingEnabled=false` ise döngü no-op olarak atlanır.
   - **Stop-loss / Take-profit taraması**: Tüm açık pozisyonlar kontrol edilir; SL/TP eşiği aşanlar otomatik satılır.
   - **AI analizi**: İzleme listesindeki hisseler için (cooldown'a tabi olanlar hariç) LLM'den karar istenir.
   - **Emir üretimi**: BUY kararı, güven skoru eşiği geçiyorsa ve risk kuralları (pozisyon tavanı, açık pozisyon sayısı, günlük bütçe) elveriyorsa alım emri açılır.
   - **Denetim**: Her döngü `JobRun` kaydına yazılır (durum, süre, özet); `/trading` sayfasındaki durum kartı bu kayıtlardan beslenir.
3. **İzolasyon ve idempotency**: Her döngü benzersiz bir `cycleId` ile çalışır; aynı cycleId tekrar işlenirse yeni emir açılmaz. Manuel pozisyonlarınıza dokunulmadan yalnızca kural tetiklemeleri işlem görür.
4. **Hata dayanıklılığı**: Haber çekme hatası, LLM hatası veya DB hatası tek döngüyü düşürür; motor bir sonraki döngüde çalışmaya devam eder.

**Önerilen ilk kullanım akışı**: Motoru önce kapalı tutun → izleme listenize 2–3 hisse ekleyin → hisse detayından manuel "Analiz Et" ile AI kararlarının kalitesini gözlemleyin → risk parametrelerini bakiyenize göre ayarlayın → motoru açıp `/trading` durum kartından döngüleri izleyin.

---

## 6. Sanal (PAPER) ve Canlı (LIVE) Mod

| Özellik | PAPER (Sanal) | LIVE (Canlı) |
| --- | --- | --- |
| Para | Sanal bakiye | Gerçek banka bakiyesi |
| İşlem türü | Hisse alım/satımı | **Yalnızca döviz** (USD/TRY) — DenizBank `ChangeExchange` |
| Komisyon | Uygulanır | Uygulanmaz |
| Otomatik motor | Çalışır | **Devre dışı** (güvenlik gereği) |
| Emir onayı | Standart | Ekstra "CANLI İŞLEM" kutusu + `liveModeConfirmedAt` damgası |
| Hisse emri | Desteklenir | `LIVE_STOCK_NOT_SUPPORTED` ile reddedilir |

**Canlı moda geçiş prosedürü** (kasıtlı olarak çok adımlıdır):

1. `.env` dosyasında `DENIZBANK_MOCK="false"` yazın; `DENIZBANK_BASE_URL` ve `DENIZBANK_APP_KEY` değerlerini bankadan aldığınız gerçek değerlerle doldurun. Uygulamayı yeniden başlatın.
2. `/admin` → Risk & Mod → **"DenizBank Bağlantısını Test Et"** — hesap listesi dönüyorsa bağlantı sağlamdır.
3. Veri tabanında `accountType: "LIVE"`, `currency: "TRY"` ve `bankAccountNumber` dolu bir hesap kaydı olmalıdır (canlı emirler bu hesap üzerinden yapılır).
4. Mod anahtarını LIVE'a çevirin ve açılan onay diyaloğunu onaylayın.
5. `/trading` sayfasında döviz emri verin; formdaki canlı işlem uyarısını onaylayın.

**Mock mod**: `DENIZBANK_APP_KEY` boşsa veya `DENIZBANK_MOCK="true"` ise sistem deterministik bir mock banka transportu ile çalışır — hiçbir gerçek banka çağrısı yapılmaz. Mock hesaplar: TRY `"1234567"` (50.000 TL), USD `"7654321"` (2.000 USD); mock kurlar USD alış 34.20 / satış 34.50. Tüm doğrulama script'leri mock modda koşar ve gerçek AppKey tanımlıysa kendilerini durdurur.

**Canlı mod riskleri**: Gerçek para hareketi olduğundan emir vermeden önce miktarı ve yönü iki kez kontrol edin. Her canlı emrin `TransactionID` ve `SessionID` mutabakat değerleri emir kaydına yazılır; tüm banka çağrıları AppKey maskeli olarak `ApiCallLog` tablosuna denetim izi olarak düşer.

---

## 7. Haber Akışı ve AI Analizi

- **Tarama**: [`google-news-scraper.ts`](src/server/providers/google-news-scraper.ts) her hisse için "sembol + şirket adı" sorgusuyla Google News RSS'ini çeker (10 sn timeout; hata durumunda boş liste döner, uygulama asla çökmez).
- **Dedup**: Her haber URL'sinin SHA-256 hash'i (`urlHash`) hesaplanır; aynı URL ikinci kez kaydedilmez.
- **Analiz context'i**: LLM'e hisse bilgisi + son haberler + fiyat geçmişi + mevcut pozisyon gönderilir. Analiz sonucu `AiAnalysisLog` tablosuna yazılır (model adı, karar, güven, gerekçe, kullanılan prompt).
- **Cooldown ve rate limit**: Aynı hissenin analizi kısa aralıklarla tekrarlanmaz; LLM sağlayıcı kotalarına karşı istekler sınırlanır.
- **Yanıt güvenliği**: LLM yanıtı JSON şemasına uymuyorsa sistem hata mesajını modele geri besleyip yeniden dener; yine başarısızsa analiz başarısız olarak loglanır ve varsayılan HOLD kabul edilir — hatalı yanıt asla emre dönüşmez.

---

## 8. Sık Sorulan Sorular ve Sorun Giderme

**S: Fiyatlar neden değişmiyor?**
Fiyatlar yalnızca piyasa tick'i ile değişir. İzleme listesindeki "Şimdi Yenile" düğmesine basın veya `POST /api/market/tick` çağırın.

**S: AI analizi "anahtar bulunamadı" hatası veriyor.**
`/admin` → AI Ayarları sekmesinden sağlayıcı seçip geçerli bir API anahtarı girin ve kaydedin. "AI Bağlantısını Test Et" ile doğrulayın.

**S: Otomatik motor emir vermiyor.**
Sırayla kontrol edin: (1) Motor anahtarı açık mı? (2) Çalışma modu PAPER mi? (3) AI güven skoru eşik altında olabilir — `/trading` durum kartındaki döngü özetine bakın. (4) Cooldown süresi dolmamış olabilir. (5) Günlük bütçe veya pozisyon limitleri dolmuş olabilir.

**S: Emrim REJECTED oldu.**
En yaygın nedenler: yetersiz sanal bakiye, maksimum pozisyon değeri aşımı, maksimum açık pozisyon sayısı aşımı veya günlük emir bütçesinin tükenmesi. Hata mesajı nedeni belirtir.

**S: Canlı moda geçemiyorum / canlı emir reddediliyor.**
`LIVE_MODE_NOT_CONFIRMED` hatası, mod değiştirme onayının (onay damgası) bulunmadığını gösterir — admin panelinden LIVE'a geçiş diyaloğunu onaylayın. `LIVE_STOCK_NOT_SUPPORTED` hatası normaldir: canlı modda yalnızca döviz işlemi yapılabilir.

**S: Veri tabanını sıfırlamak istiyorum.**
```bash
npm run db:reset   # Şemayı sıfırlar ve seed'i yeniden yükler
```
Bu komut tüm verileri (pozisyonlar, emirler, haberler dahil) siler.

**S: Uygulamayı üretimde nasıl çalıştırırım?**
```bash
npm run build
npm run start
```

**S: Her şeyin sağlıklı olduğundan nasıl emin olurum?**
```bash
npm run typecheck    # TypeScript strict kontrolü
npm run verify:all   # 7 script, 101 kontrol — hepsi mock modda, güvenli
```

---

*Bu kılavuz [`src/app`](src/app) sayfaları, [`src/components`](src/components) arayüz bileşenleri ve [`src/server`](src/server) servis katmanındaki gerçek davranışlara dayanarak hazırlanmıştır.*
