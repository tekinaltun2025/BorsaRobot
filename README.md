# BorsaRobot

AI destekli borsa takip, haber analizi ve otomatik alım-satım platformu. Next.js 15 (App Router) üzerinde koşan, **çift modlu** (Sanal/PAPER + Canlı/LIVE) bir ticaret sistemidir: hisse fiyatları simüle edilir, haberler taranır, LLM (Gemini/OpenAI/Claude/DeepSeek/Grok/Mistral/Local AI) ile analiz edilir ve otomatik alım-satım motoru sinyalleri emre çevirir. Canlı modda döviz işlemleri **DenizBank API Market** üzerinden gerçekleştirilir.

> Ayrıntılı mimari kararlar, katman diyagramları ve sözleşme analizi için [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); sayfa sayfa kullanım rehberi için [`KULLANIM.md`](KULLANIM.md) belgesine bakın.

## İçindekiler

- [Özellikler](#özellikler)
- [Teknoloji Yığını](#teknoloji-yığını)
- [Kurulum](#kurulum)
- [Çalıştırma](#çalıştırma)
- [Test ve Doğrulama](#test-ve-doğrulama)
- [AI Sağlayıcıları](#ai-sağlayıcıları)
- [Fiyat Kaynağı (Yahoo Finance)](#fiyat-kaynağı-yahoo-finance)
- [Canlı Mod Prosedürü (DenizBank)](#canlı-mod-prosedürü-denizbank)
- [Canlı Mod Riskleri](#canlı-mod-riskleri)
- [DenizBank: Mock ve Gerçek Mod](#denizbank-mock-ve-gerçek-mod)
- [Üretimde 7/24 Çalıştırma (cPanel/VPS)](#üretimde-724-çalıştırma-cpanelvps)
- [Proje Yapısı](#proje-yapısı)

## Özellikler

- **Piyasa simülasyonu**: Seed'li deterministik fiyat üretimi, OHLC PriceHistory, 1D/1W/1M/3M/1Y mum grafikleri ([`market-simulator.ts`](src/server/services/market-simulator.ts), [`price-service.ts`](src/server/services/price-service.ts)).
- **Haber tarama**: Google News kazıyıcı, SHA-256 `urlHash` ile deduplasyon ([`news-service.ts`](src/server/services/news-service.ts)).
- **AI analizi**: 7 LLM sağlayıcısı (Gemini/OpenAI/Claude/DeepSeek/Grok/Mistral/Local AI) yapılandırılmış JSON çıktısı, Zod doğrulama, retry + hata geri beslemesi, cooldown ve rate limit ([`analysis-service.ts`](src/server/services/analysis-service.ts), [`llm-provider-factory.ts`](src/server/providers/llm-provider-factory.ts)).
- **Otomatik alım-satım motoru**: AI sinyali + stop-loss/take-profit taraması, risk kuralları, idempotent döngüler, JobRun denetim kayıtları ([`auto-trade-service.ts`](src/server/services/auto-trade-service.ts)).
- **Çift modlu ticaret**: `PAPER` (sanal bakiye/komisyonlu) ve `LIVE` (DenizBank ChangeExchange) motorları aynı `ITradingProvider` arayüzü arkasında — Strategy Pattern ([`trading-provider.ts`](src/server/providers/trading-provider.ts)).
- **Canlı mod güvenlik katmanı**: `liveModeConfirmedAt` onay damgası guard'ı, LIVE'da otomatik motor devre dışı, emir formunda ekstra "CANLI İŞLEM" onayı, admin bağlantı testi.
- **DenizBank adaptörü**: GUID (ChannelSessionId/ChannelRequestId) üretimi, Zod sözleşme doğrulaması, hata sınıflandırma (TRANSIENT/PERMANENT/DEFERRED), idempotent retry, AppKey maskeli `ApiCallLog` denetim izi ([`denizbank-base-client.ts`](src/server/providers/denizbank/denizbank-base-client.ts)).

## Teknoloji Yığını

| Katman | Teknoloji |
| --- | --- |
| UI | Next.js 15 (App Router), React 19, Tailwind CSS 4, lightweight-charts |
| API | Next.js Route Handlers (`src/app/api/**`) |
| Veri | Prisma 6 + SQLite (geliştirme), Decimal ile parasal hesap |
| AI | Google Gemini / OpenAI / Anthropic Claude / DeepSeek / xAI Grok / Mistral / Local AI (OpenAI-uyumlu; Ollama, LM Studio vb.) |
| Banka | DenizBank API Market (JSON Header + `Parameters` zarfı) |
| Test | Vitest (73 birim testi) + `tsx` ile koşan entegrasyon senaryoları (`scripts/verify-*.ts`) + GitHub Actions CI |

## Kurulum

Gereksinimler: Node.js ≥ 18.18, npm.

```bash
# 1) Bağımlılıklar
npm install

# 2) Ortam değişkenleri
cp .env.example .env
# .env içindeki anahtarları düzenleyin (aşağıya bakın)

# 3) Prisma client + veri tabanı şeması + seed
npm run db:generate
npm run db:push
npm run db:seed
```

### Ortam Değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `DATABASE_URL` | SQLite dosya yolu (geliştirme: `file:./dev.db`) |
| `DENIZBANK_BASE_URL` | DenizBank API Market temel adresi (canlı mod için zorunlu) |
| `DENIZBANK_APP_KEY` | Bankadan alınan AppKey. **Boş bırakılırsa sistem mock modda koşar** |
| `DENIZBANK_MOCK` | `"true"` → her koşulda mock transport (test güvenliği) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | İlk kurulumda AdminSettings'e taşınır; sonrasında admin panelinden yönetilir |
| `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `GROK_API_KEY` / `MISTRAL_API_KEY` | İlk kurulumda AdminSettings'e taşınır; admin panelinden yönetilir |
| `CUSTOM_BASE_URL` / `CUSTOM_API_KEY` / `CUSTOM_MODEL` | Local AI (Ollama, LM Studio vb.) OpenAI-uyumlu endpoint ayarları; admin panelinden yönetilir |
| `NEXT_PUBLIC_APP_NAME` | Uygulama görünen adı |

> **Güvenlik**: AppKey asla koda gömülmez; `ApiCallLog` kayıtlarında daima maskelenir.

## Çalıştırma

```bash
npm run dev     # geliştirme sunucusu → http://localhost:3000
npm run build    # üretim derlemesi
npm run start    # üretim sunucusu
```

Ana sayfalar:

- `/` — izleme listesi ve canlı fiyat görünümü
- `/stock/[symbol]` — grafik, haberler, AI analizi
- `/trading` — emir formu, portföy, emir geçmişi, hesap özeti
- `/admin` — ayarlar (AI, risk, otomatik ticaret), mod değiştirme (PAPER/LIVE), DenizBank bağlantı testi

## Test ve Doğrulama

Her katmanın kendi doğrulama script'i vardır; hepsi **mock/simülasyon** üzerinden koşar — hiçbir test gerçek bankaya veya LLM'e istek atmaz.

```bash
npm run test:run           # Vitest birim testleri (73 test — auth, crypto, rate limit, time, signal-processor, ...)
npm run verify:db          # Şema + seed + temel DB sözleşmeleri
npm run verify:market      # Piyasa simülasyonu, mumlar, istatistikler (21 kontrol)
npm run verify:trading     # Paper motor: emirler, bakiye, risk, idempotency (19 kontrol)
npm run verify:ai              # LLM parse/retry, haber dedup, cooldown (19 kontrol)
npm run verify:ai-providers    # 7 LLM sağlayıcısı: factory, validator, Local AI (20 kontrol)
npm run verify:auto-trade      # Otomatik motor: SL/TP, eşik, izolasyon (13 kontrol)
npm run verify:denizbank       # DenizBank adaptörü: GUID, retry, hata sınıflaması (15 kontrol)
npm run verify:e2e             # Uçtan uca: tick → haber → AI → emir → LIVE → PAPER (15 kontrol)
npm run verify:all             # Yukarıdakilerin hepsi sırayla
npm run typecheck          # tsc --noEmit (strict)
npm run lint               # ESLint (0 hata hedefi)
```

`verify:e2e` senaryosu, sistemin tamamını tek akışta kanıtlar: piyasa tick'i → haberin analiz context'ine girişi → AI kararı → otomatik emir → portföy → LIVE moda geçiş → canlı mod guard'ı → mock banka üzerinden canlı döviz alım/satımı (TransactionID/SessionID mutabakatı + bakiye muhasebesi) → PAPER'a dönüş. Script, `DENIZBANK_APP_KEY` tanımlıysa (mock mod kapalıysa) kendini durdurur — testler daima mock'tur.

## AI Sağlayıcıları

AI analizi **7 sağlayıcı** ile yapılabilir; seçim [`/admin`](src/app/admin/page.tsx) paneli → AI Ayarları → "Aktif Sağlayıcı" açılır listesinden yapılır. Her sağlayıcının API anahtarı ve modeli admin panelinden yönetilir; anahtarlar API yanıtlarında daima maskelenir (son 4 karakter).

| Sağlayıcı | Anahtar | Varsayılan model |
| --- | --- | --- |
| Google Gemini | GEMINI_API_KEY | gemini-2.5-flash |
| OpenAI | OPENAI_API_KEY | gpt-4o-mini |
| Anthropic Claude | ANTHROPIC_API_KEY | claude-sonnet-4-5 |
| DeepSeek | DEEPSEEK_API_KEY | deepseek-chat |
| xAI Grok | GROK_API_KEY | grok-4 |
| Mistral | MISTRAL_API_KEY | mistral-small-latest |
| **Local AI (Custom)** | opsiyonel | serbest metin (örn. `llama3.2`) |

- **Local AI**: Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`) veya herhangi bir OpenAI-uyumlu endpoint; Base URL zorunlu, API key ve model adı girilir ([`openai-compatible-provider.ts`](src/server/providers/openai-compatible-provider.ts)).
- **Doğrulama**: `npm run verify:ai-providers` — factory sınıf seçimi, koşullu validator, maskeli anahtar görünümü, Local AI key'siz istek senaryosu (20 kontrol). Ollama kuruluysa canlı bağlantı testi de otomatik denenir.

## Fiyat Kaynağı (Yahoo Finance)

Piyasa verileri **varsayılan olarak Yahoo Finance**'ten gerçek BIST fiyatları olarak çekilir (API key gerektirmez); Yahoo erişilemezse otomatik olarak **simülatöre (yedek)** düşülür ve UI'da "Simüle Veri" rozetiyle bildirilir.

- **Kaynak seçimi**: `AdminSettings.priceSource` (`YAHOO` | `SIMULATED`) — [`/admin`](src/app/admin/page.tsx) paneli → Risk & Mod → Fiyat Kaynağı'ndan değiştirilebilir; "Bağlantıyı Test Et" butonu THYAO.IS güncel fiyatıyla bağlantıyı doğrular.
- **Env override**: `PRICE_SOURCE=SIMULATED` yazılarak simülatör zorlanabilir (ayar okunamazsa env'e düşülür).
- **Kapsam**: İzleme listesi fiyatları, tick akışı ve gerçek OHLC geçmişi (1D–1Y mumlar) Yahoo v8/v7 endpoint'lerinden çekilir; `Stock.lastPrice` + `PriceHistory` gerçek fiyatla güncellenir.
- **Doğrulama**: `npm run verify:yahoo` — sembol dönüşümü (THYAO → THYAO.IS, USDTRY → USDTRY=X), gerçek fiyat, OHLC tutarlılığı, fallback ve ApiCallLog denetim kaydı.

## Canlı Mod Prosedürü (DenizBank)

Canlı moda geçiş **kasıtlı olarak çok adımlıdır**; her adım bir güvenlik katmanıdır.

1. **Ortamı hazırlayın**: `.env` içinde `DENIZBANK_MOCK="false"` yazın, `DENIZBANK_BASE_URL` ve `DENIZBANK_APP_KEY` değerlerini bankadan aldığınız gerçek değerlerle doldurun. Uygulamayı yeniden başlatın.
2. **Bağlantıyı test edin**: `/admin` → Mod bölümü → **"Bağlantıyı Test Et"**. Bu, `GetAccountList` çağrısıyla AppKey ve temel adresi doğrular; hesap listesi dönüyorsa bağlantı sağlamdır.
3. **LIVE hesabı yapılandırın**: Veri tabanında `accountType: "LIVE"`, `currency: "TRY"` ve `bankAccountNumber` dolu bir `Account` kaydı olmalıdır. Canlı emirler bu hesap üzerinden gerçekleştirilir; PAPER hesaplara asla dokunulmaz.
4. **Modu değiştirin**: `/admin` → PAPER/LIVE anahtarını LIVE'a çevirin. Açık onay diyalogunu onaylayın — bu onay `AdminSettings.liveModeConfirmedAt` damgasını yazar.
5. **Emir verin**: `/trading` sayfasında döviz emri verin. Form, LIVE modda ek bir **"CANLI İŞLEM"** onay kutusu ister; onaysız emir gönderilmez.

### Canlı modda ne değişir?

- **Otomatik motor durur**: `runAutoTradeCycle`, `tradingMode !== "PAPER"` olduğunda döngüyü güvenlik gereği atlar. Canlı modda otomatik emir **asla** verilmez.
- **Hisse emirleri reddedilir**: DenizBank API Market yalnızca döviz alım-satımı (`ChangeExchange`) sunar; hisse emirleri `LIVE_STOCK_NOT_SUPPORTED` ile reddedilir.
- **Guard devrede**: `liveModeConfirmedAt` damgası yoksa (örn. veri tabanı elle değiştirildi) tüm emirler `LIVE_MODE_NOT_CONFIRMED` (403) ile reddedilir.
- **Mutabakat**: Her canlı emir, bankanın döndürdüğü `TransactionID` ve `SessionID` değerlerini `Order` kaydına yazar; `GetTransactionDetail` ile sorgulanabilir.

## Canlı Mod Riskleri

- **Gerçek para**: LIVE moddaki döviz emirleri gerçek bakiyeyi hareket ettirir. Emir vermeden önce miktarı ve yönü iki kez kontrol edin.
- **Yalnızca döviz**: Bankanın sunduğu endpoint kümesi sınırlıdır; hisse senedi canlı işlemi bu platformda mümkün değildir.
- **Ağ gecikmeleri**: Canlı emirler 30 saniyeye kadar tx timeout ile korunur; yine de banka yanıt gecikmesi emrin durumunu geç güncelleyebilir. `ApiCallLog` kayıtları her çağrının (başarılı/hatalı) denetim izini tutar.
- **Idempotency**: Aynı `clientRequestId` tekrar gönderilirse yeni emir açılmaz, mevcut emir döndürülür. Banka tarafında retry'ler aynı `ChannelRequestId`'yi korur — çift para hareketi imkânsızdır.
- **Onay damgası**: `liveModeConfirmedAt` olmadan hiçbir canlı emir geçmez; damga, mod değiştirme onayının kaydıdır.

## DenizBank: Mock ve Gerçek Mod

Sistem, `DENIZBANK_APP_KEY` boş olduğunda **deterministik mock transport** ile koşar:

- Mock hesaplar: TRY `"1234567"` (50.000 TL), USD `"7654321"` (2.000 USD).
- Mock kurlar: USD alış 34.20 / satış 34.50.
- `TransactionID` değerleri `MOCKTX000001` biçiminde sayaçla üretilir → testler öngörülebilir.
- Mock transport, `client.mockTransport` üzerinden hata enjeksiyonu (ağ hatası, timeout, banka hatası) ve `reset()` imkânı sunar.

Gerçek moda geçiş yalnızca geçerli `DENIZBANK_APP_KEY` + `DENIZBANK_MOCK="false"` ile mümkündür. Tüm doğrulama script'leri mock modda koşar; script'ler AppKey tanımlıysa kendilerini durdurur.

## Üretimde 7/24 Çalıştırma (cPanel/VPS)

Otomatik alım-satım ve BIST 100 senkron zamanlayıcıları uygulama sürecinin sürekli ayakta kalmasını gerektirir. **Paylaşımlı cPanel paketleri bu model için uygun değildir** (süreç kısıtları, eski Node sürümü, build RAM limitleri); **root erişimli bir VPS** (cPanel VPS dahil) önerilir.

- **Yol A — VPS + PM2 (önerilen):** [`ecosystem.config.js`](ecosystem.config.js) hazır gelir — `autorestart`, 512 MB bellek restart sınırı, `pm2 startup` ile reboot'ta otomatik başlama. Nginx + Let's Encrypt adımları dahil.
- **Yol B — cPanel VPS + "Setup Node.js App" (Passenger):** Build'i kendi bilgisayarınızda yapıp `.next/standalone` çıktısını yüklersiniz; Passenger süreci ayakta tutar.

Adım adım kurulum, üretim ortam değişkenleri (`ADMIN_PASSWORD`, `SETTINGS_ENCRYPTION_KEY`, absolute `DATABASE_URL`), SQLite yedekleme cron'u ve sorun giderme tablosu için **[`DEPLOYMENT.md`](DEPLOYMENT.md)** belgesine bakın.

## Yol Haritası

Bilinçli olarak ertelenmiş kalemler (detaylı gerekçe: [`ARCHITECTURE.md` § 0.3](docs/ARCHITECTURE.md)):

1. **PostgreSQL geçişi** — Şema provider-bağımsız; geçiş `DATABASE_URL` + `prisma migrate deploy` ile planlıdır. Tek kullanıcı/tek sunucu profili için SQLite bilinçli seçimdir.
2. **pino yapılandırılmış loglama** — `console.*` çağrılarının JSON log akışına taşınması.
3. **SSE canlı fiyat akışı** — Watchlist polling'inin Server-Sent Events ile değiştirilmesi.
4. **Alarm kanalı** — Scheduler başarısız tick'lerinde e-posta/Telegram bildirimi.
5. **Açık tema** — `next-themes` ile light/dark geçişi.

## Proje Yapısı

```
prisma/                  # Şema, migration'lar, seed
scripts/                 # verify-*.ts doğrulama script'leri (tsx ile koşar)
tests/                   # Vitest birim testleri
src/app/                 # Sayfalar + Route Handler API'leri (+ loading/error/not-found segment dosyaları)
src/components/          # UI bileşenleri (admin, trading, stock, watchlist, ui/states)
src/lib/                 # Prisma client, tipler, Zod validator'lar, time/crypto/auth yardımcıları
src/server/providers/    # DenizBank adaptörü, paper/live motorlar, LLM, haber
src/server/services/     # İş mantığı: trading, auto-trade, analysis, market, risk, scheduler, ...
.github/workflows/       # CI: typecheck + lint + test (her push)
docs/ARCHITECTURE.md     # Mimari tasarım dokümanı (ADR'ler, sözleşme analizi, Mevcut Durum)
DEPLOYMENT.md            # Üretim kurulumu: VPS+PM2 ve cPanel Passenger yolları, yedekleme, sorun giderme
ecosystem.config.js      # PM2 süreç tanımı (7/24 autorestart + bellek sınırı)
```
