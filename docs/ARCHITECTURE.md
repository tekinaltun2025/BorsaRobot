# AI Destekli Borsa Takip, Haber Analizi ve Otomatik Alım-Satım Platformu
## Mimari Tasarım Dokümanı — Faz 0

| Özellik | Değer |
|---|---|
| **Doküman Sürümü** | 1.1 |
| **Tarih** | 2026-10-03 (v1.0) · 2026-10-11 (v1.1 — iyileştirme turu sonrası güncellendi) |
| **Durum** | Uygulandı — Faz 0 tasarımı; aşağıdaki "Mevcut Durum" bölümü gerçek implementasyonu yansıtır |
| **Kaynak API Dokümanı** | `docs/DenizBank API Market Download.txt` (5.900 satır, tamamen analiz edildi) |
| **Hedef Teknoloji Yığını** | Next.js 15 (App Router) · TypeScript 5 · Prisma ORM · SQLite (bkz. ADR-5 revizyonu) · Tailwind CSS 4 · TradingView Lightweight Charts |

---

## İçindekiler

0. [Mevcut Durum (v1.1)](#0-mevcut-durum-v11)
1. [Genel Bakış ve Mimari Özet](#1-genel-bakış-ve-mimari-özet)
2. [DenizBank API Sözleşme Analizi](#2-denizbank-api-sözleşme-analizi)
3. [Sistem Mimarisi](#3-sistem-mimarisi)
4. [Çekirdek Arayüz ve Sınıf Tasarımları](#4-çekirdek-arayüz-ve-sınıf-tasarımları)
5. [Veri Tabanı Şeması — Prisma](#5-veri-tabanı-şeması--prisma)
6. [Dizin Yapısı Planı](#6-dizin-yapısı-planı)
7. [Bağımlılık Planı](#7-bağımlılık-planı)
8. [Faz Bazlı Geliştirme Planı ve Kabul Kriterleri](#8-faz-bazlı-geliştirme-planı-ve-kabul-kriterleri)
9. [Risk Analizi, Güvenlik ve Operasyonel Hususlar](#9-risk-analizi-güvenlik-ve-operasyonel-hususlar)

---

## 0. Mevcut Durum (v1.1)

> Bu bölüm, Faz 0 tasarımının uygulanmasından sonra (Faz 1–7 + 2026-10-11
> iyileştirme turu) kod tabanının **gerçek** durumunu özetler. Dokümanın
> geri kalanı orijinal Faz 0 tasarımını korur; sapmalar burada işaretlenmiştir.

### 0.1 ADR Durum Tablosu

| # | Faz 0 Kararı | Durum | Not |
|---|---|---|---|
| ADR-1 | Modüler Monolith | ✅ Uygulandı | Katman disiplini korundu: `app/api` → `server/services` → `server/providers` → Prisma |
| ADR-2 | Strategy Pattern `ITradingProvider` | ✅ Uygulandı | [`trading-provider.ts`](../src/server/providers/trading-provider.ts) + PAPER/LIVE implementasyonları |
| ADR-3 | Generic `DenizBankBaseClient` | ✅ Uygulandı | Zod sözleşme doğrulaması + hata sınıflandırma eklendi |
| ADR-4 | Provider soyutlaması | ✅ Uygulandı | `ILlmProvider` (8 sağlayıcı), `IPriceSource` (Yahoo/Simülasyon), Google News kazıyıcı |
| ADR-5 | Prisma + **PostgreSQL** | ⚠️ Revize | **SQLite** (`file:./dev.db`) ile uygulanıyor — tek kullanıcı/tek sunucu profili için bilinçli seçim. Şema provider-bağımsız olduğundan Postgres geçişi yalnızca `DATABASE_URL` + `migrate deploy` gerektirir (Yol Haritası'na alındı) |
| ADR-6 | Zorunlu Mutabakat | ✅ Uygulandı | `GetTransactionDetail` ile emir sonucu doğrulama |
| ADR-7 | Idempotency `clientRequestId` | ✅ Uygulandı | `Order.clientRequestId` unique kısıtı |
| ADR-8 | Decimal(18,4) | ✅ Uygulandı | Hesaplamalarda `Number` yasak; `dec()` yardımcısı null-güvenli |
| ADR-9 | Zod LLM doğrulama | ✅ Uygulandı | Retry + hata geri beslemesi ile [`llm-response-parser.ts`](../src/server/services/llm-response-parser.ts) |
| ADR-10 | **Vercel Cron** + JobRun | ⚠️ Revize | **In-process scheduler** ([`scheduler.ts`](../src/server/services/scheduler.ts)) `instrumentation.ts` ile başlar; dakika-bazlı `JobRun` kilidi (claimTickLock) çoklu-instance çakışmasını önler. Vercel Cron'a geçiş Yol Haritası'nda |

### 0.2 Faz 0'dan Sonraki Değişiklikler

- **Güvenlik**: Admin oturum çerezi (HMAC imzalı) + middleware koruması, IP+route rate limit, API anahtarları AES-256-GCM ile şifreli saklama ([`crypto.ts`](../src/lib/crypto.ts)), `ApiCallLog` gizli veri maskeli.
- **Test**: Vitest 73 birim testi + `scripts/verify-*.ts` entegrasyon senaryoları + GitHub Actions CI (typecheck/lint/test).
- **Servis ayrıştırma**: Monolitik `trading-service` → `trading-error` / `risk-service` / `signal-processor`; `settings-service`'e `buildAdminSettingsUpdateData` birleştirme.
- **Performans**: Yahoo Finance paralel fetch (4 şeritli eşzamanlılık + zincir-korumalı throttle), haber `createMany` toplu yazımı, ana sayfa ISR (`revalidate=10`), grafik sorgusu 5000 kayıt sınırı.
- **Operasyon**: `GET /api/health` (DB ping + scheduler durumu), scheduler dakika-bazlı DB kilidi, iş saat dilimi `Europe/Istanbul`'a sabitlendi ([`time.ts`](../src/lib/time.ts)) — günlük bütçe penceresi sunucu TZ'sinden bağımsız.
- **UI/UX**: Kök + segment `loading.tsx`/`error.tsx`/`not-found.tsx`, ortak durum bileşenleri ([`states.tsx`](../src/components/ui/states.tsx)), mobil hamburger menü.
- **Veri**: `ApiCallLog`/`AnalysisLog` günlük retention, PAPER modda FX emri dürüst ret, `Account.ownerId` izolasyonu, BIST 100 senkronizasyonu.
- **Ertelenen kalemler**: pino yapılandırılmış loglama, SSE canlı fiyat akışı, alarm kanalı (e-posta/Telegram), açık tema (next-themes) — Yol Haritası'nda.

### 0.3 Yol Haritası (Ertelenen Kalemler)

1. **PostgreSQL geçişi**: `DATABASE_URL` değişimi + `prisma migrate deploy`; Decimal/JSON alanları provider-bağımsız.
2. **pino yapılandırılmış loglama**: `console.*` çağrılarının JSON log akışına taşınması.
3. **SSE canlı fiyat akışı**: Watchlist sayfası polling yerine Server-Sent Events.
4. **Alarm kanalı**: Scheduler başarısız tick'lerinde e-posta/Telegram bildirimi.
5. **Açık tema**: `next-themes` ile light/dark geçişi (tüm bileşenlerde renk denetimi gerektirir).

---

## 1. Genel Bakış ve Mimari Özet

### 1.1 Projenin Amacı

Bu platform, Borsa İstanbul hisse senetlerini takip eden, günlük haber akışını tarayıp LLM (Large Language Model) tabanlı duygu analizi yapan ve bu analiz sonuçlarına göre **otomatik alım-satım kararı veren**; alım-satım işlemlerini DenizBank API Market üzerinden **döviz alım-satımı (ChangeExchange)** ile gerçekleştiren bir sistemdir.

Sistem iki çalışma moduna sahiptir:

- **Sanal Mod (Paper Trading):** Gerçek para kullanılmadan, simüle edilmiş bakiye ve emirlerle strateji test edilir.
- **Canlı Mod (Live Trading):** DenizBank API üzerinden gerçek döviz alım-satım işlemleri yapılır.

Yönetici (admin), tek panel üzerinden mod geçişini, AI sağlayıcıyı, analiz promptlarını ve risk parametrelerini dinamik olarak yönetir.

### 1.2 Mimari Kararlar (ADR Özeti)

| # | Karar | Gerekçe |
|---|---|---|
| ADR-1 | **Modüler Monolith** (Clean Architecture katmanlarıyla) | Tek kişilik ekip + tek sunucu dağıtımı için microservices aşırı maliyetli; ancak katman disiplini (UI → Service → Provider → DB) sayesinde ileride servis ayrıştırma kolaylaştırılır. |
| ADR-2 | **Strategy Pattern ile `ITradingProvider`** | Sanal/canlı mod geçişi kod değişikliği gerektirmeden, çalışma zamanında (runtime) admin panelinden yapılabilir olmalı. |
| ADR-3 | **Generic `DenizBankBaseClient`** | Dokümandaki 170+ endpoint'in tamamı aynı `Header` + `Parameters` zarf yapısını kullanıyor; tek generic istemci + endpoint-bazlı tip tanımları en düşük tekrar oranı sağlar. |
| ADR-4 | **Provider Soyutlaması (`ILlmProvider`, `INewsScraper`, `IStockPriceProvider`)** | AI sağlayıcı (Gemini/OpenAI) ve veri kaynakları admin panelinden değiştirilebilir olmalı; vendor lock-in önlenir. |
| ADR-5 | **Prisma + PostgreSQL** | İlişkisel veri (emirler, pozisyonlar, hareketler) + JSON alan ihtiyacı (LLM ham yanıtları, API ham istek/yanıtlar) için en dengeli seçim; migration disiplini hazır gelir. |
| ADR-6 | **Zorunlu Mutabakat (Reconciliation) Akışı** | DenizBank'ta para hareketi içeren her işlemin sonucu `GetTransactionDetail` (TransactionID + SessionID) ile doğrulanmalıdır; "yanıt alınamadı ≠ işlem başarısız" kuralı mimarinin merkezindedir. |
| ADR-7 | **Idempotency Anahtarı (`clientRequestId`)** | Aynı emrin iki kez gönderilmesi, ağ timeout'ları sonrası tekrar denemeler ve LLM'in aynı analizi iki kez tetiklemesi `Order.clientRequestId` unique kısıtıyla engellenir. |
| ADR-8 | **Decimal Duyarlılık Politikası** | Tüm parasal tutarlar Prisma `Decimal(18,4)` olarak saklanır; hesaplamalarda string→Decimal dönüşümü zorunludur, `Number` tipi para hesabında **yasaktır**. |
| ADR-9 | **Zod ile LLM Çıktı Doğrulama** | LLM çıktıları güvenilmezdir; `action: BUY/SELL/HOLD`, `confidence: 0-1` gibi alanlar Zod şemasıyla doğrulanmadan emir motoruna asla girmez. |
| ADR-10 | **Arka Plan İşleri için Vercel Cron + Kuyruk Tablolu Job Pattern** | Next.js App Router'da `app/api/cron/*` route'ları + DB'de `JobRun` tablosu ile tekrar denemeli, izlenebilir zamanlanmış görevler (haber taraması, fiyat çekme, emir denetimi). |

### 1.3 Sistem Bileşenleri (Özet)

| Bileşen | Sorumluluk |
|---|---|
| **Web Arayüzü (Next.js App Router)** | Hisse takip ekranları, grafikler, portföy, emir geçmişi, admin paneli |
| **Hizmet Katmanı (`src/server/services`)** | İş kuralları: emir servisleri, analiz servisleri, portföy servisi, risk servisi |
| **Sağlayıcı Katmanı (`src/server/providers`)** | Dış dünya entegrasyonları: DenizBank, hisse fiyatı, haber, LLM |
| **Otomatik Al/Sat Motoru** | LLM analizi + risk kuralları + emir durum makinesini birleştiren karar ve tetikleme motoru |
| **Zamanlanmış Görevler (Cron)** | Fiyat çekme, haber tarama, analiz tetikleme, emir durum denetimi, mutabakat |
| **PostgreSQL (Prisma)** | Tüm kalıcı veri |

---

## 2. DenizBank API Sözleşme Analizi

> Bu bölüm, `docs/DenizBank API Market Download.txt` (5.900 satır) dokümanının tam analizi sonucunda çıkarılan sözleşme kurallarını içerir. Tüm platform entegrasyonu bu kurallara göre tasarlanmıştır.

### 2.1 Genel Sözleşme Kuralları

- Tüm endpoint'ler **HTTP POST** metodunu ve `application/json` içerik tipini kullanır. REST kaynak semantiği yoktur; her endpoint bir "operasyon"dur.
- Her istek gövdesi (request envelope) tam olarak iki üst düzey alan içerir:

```json
{
  "Header": {
    "AppKey": "coVU2MZkLX6nAGLmINrmbwvdJVQ8b2LfcLy4uJCQcRaZ6hFhON",
    "Channel": "API",
    "ChannelSessionId": "Her istekte farklı GUID değerler girilmeli",
    "ChannelRequestId": "Her istekte farklı GUID değerler girilmeli"
  },
  "Parameters": [ {} ]
}
```

- **Header nesnesi (her istekte zorunlu):**

| Alan | Tip | Kural |
|---|---|---|
| `AppKey` | `string` | Uygulama anahtarı. Dokümandaki örnek değer `coVU2MZkLX6nAGLmINrmbwvdJVQ8b2LfcLy4uJCQcRaZ6hFhON`'dur; üretimde **asla koda gömülmez**, `DENIZBANK_APP_KEY` ortam değişkeninden okunur. |
| `Channel` | `string` | Sabit `"API"` değeri. |
| `ChannelSessionId` | `string (GUID)` | **Her istekte taze (farklı) GUID üretimi zorunludur.** |
| `ChannelRequestId` | `string (GUID)` | **Her istekte taze (farklı) GUID üretimi zorunludur.** |

- **`Parameters`** alanı: `Array<object>` — endpoint'e özgü parametre nesnelerini taşır. Doküman örneklerinde `{}` (boş nesne) gösterilse de, gerçek çağrılarda endpoint'in iş kurallarına göre doldurulur.
- **Yanıt şeması:** HTTP 200 + `{ "Data": object }` zarfı; endpoint'e özgü alanlar `Data` içinde döner. Hata durumları da HTTP 200 içinde, `Data` içindeki hata kodu/mesajı ile taşınabilir — bu nedenle **HTTP durum kodu başarıya eşitlenemez**, `Data` içeriği mutlaka denetlenmelidir.
- Dokümanda **170+ endpoint, 17 kategori** mevcuttur: Accounts, Change Exchange, Common, Credit, Credit Card, DDS, Deposit Accounts, ECommerceLoan, Factoring, Fast, Fast Credit, Integration (oAuth), Invoice, Money Transfer, POS, Producer Card, RetailCredit, Tax.

### 2.2 Proje için Kritik Endpoint'ler

#### 2.2.1 Hesap ve Bakiye (Accounts)

| Endpoint | URL | Açıklama | Platform Kullanımı |
|---|---|---|---|
| `GetAccountList` | `POST /GetAccountList` | Hesap listesini gösterir | Canlı modda bakiye senkronizasyonu |
| `GetAccountDetail` | `POST /GetAccountDetail` | Hesap detay bilgilerini gösterir | Tek hesap bakiye/IBAN doğrulama |
| `GetAccountTransactionList` | `POST /GetAccountTransactionList` | Hesap hareketlerini gösterir | Emir sonrası hareket mutabakatı |
| `GetCancelledAccountTransactionList` | `POST /GetCancelledAccountTransactionList` | İptal edilen işlemleri listeler | İptal edilen emirlerin denetimi |
| `GetReceiptData` | `POST /GetReceiptData` | Dekont gösterimi yapar | Emir detay ekranında dekont görüntüleme |

> **Tarih aralığı kısıtı:** Hesap hareketi sorgularında `201004` (aralık çok geniş) ve `201005` (başlangıç > bitiş) hataları dönme ihtimaline karşı, hareket sorguları **parçalı (örn. 30 günlük) pencerelerle** yapılır ve istemci tarafında birleştirilir.

#### 2.2.2 Döviz Alım-Satımı (Change Exchange) — Platformun Çekirdek İşlemi

| Endpoint | URL | Açıklama | Platform Kullanımı |
|---|---|---|---|
| `ChangeExchange` | `POST /ChangeExchange` | Döviz alım-satım işlemini gerçekleştirir | **Canlı emir gerçekleştirme (tek gerçek para hareketi)** |
| `CheckChangeExchangeReservationDailyVolume` | `POST /CheckChangeExchangeReservationDailyVolume` | Günlük döviz alım-satım limitini kontrol eder | Emir öncesi ön kontrol (guard) |
| `GetCurrencyRateList` | `POST /GetCurrencyRateList` | Kur oran listesini gösterir | Emir öncesi güncel kur çekme, kur geçmişi kaydı |
| `GetKgvInfo` | `POST /GetKgvInfo` | Kambiyo Gider Vergisi (KGV) bilgisini gösterir | Emir maliyet hesabı (net tutar) |
| `GetRateReservationParameter` | `POST /GetRateReservationParameter` | Kur rezervasyon bilgisini gösterir | Kur rezervasyon süresi parametre yönetimi |

**`ChangeExchange` iş kuralı (dokümandan kritik alıntı — birebir korunmalı):**

> *"The TransactionType field for the sales transaction must be the amount of currency to be sold in the Exchange, Amount field, and TL in the ConvertedAmount field. The TransactionType field for the purchase transaction must be the amount of the currency to be traded in the ConvertedAmount field, and TL in the Amount field."*

Türkçe karşılığı ve platformdaki karşılığı:

| İşlem | `TransactionType` | `Amount` | `ConvertedAmount` |
|---|---|---|---|
| **Satış** (örn. USD sat) | Satılacak döviz cinsi (`"USD"`) | Satılacak döviz tutarı | TL karşılığı |
| **Alım** (örn. USD al) | Alınacak döviz cinsi (`"USD"`) | **TL tutarı** | **Alınacak döviz tutarı** |

> ⚠️ **Tasarım etkisi:** Alım ve satışta `Amount`/`ConvertedAmount` anlamları yer değiştirir. Bu asimetri, `DenizBankLiveAdapter.changeExchange()` içinde tek bir yerde (`buildChangeExchangeParams`) kapsüllenir ve kapsül dışında hiçbir kod bu kuralı bilmek zorunda değildir. Birim testlerinde iki yön de ayrı ayrı doğrulanır.

#### 2.2.3 Mutabakat ve oAuth (Integration / Money Transfer)

| Endpoint | URL | Açıklama | Platform Kullanımı |
|---|---|---|---|
| `GetTransactionDetail` | `POST /GetTransactionDetail` | TransactionID + SessionID ile işlemin başarı/başarısızlık mutabakatı | **Emir sonrası nihai durum doğrulama (tek doğruluk kaynağı)** |
| `CreateApiTransactionRequest` | `POST /CreateApiTransactionRequest` | oAuth ile işlem başlatır (tutar, tekil işlem kodu `RequestId`, metot bilgisi) | oAuth akışı gerektiren işlemlerde işlem başlatma |
| `GetApiTransactionDetail` | `POST /GetApiTransactionDetail` | oAuth ile başlatılan işlemin doğrulaması | oAuth işlem sonucu sorgulama |
| `CancelApiTransaction` | `POST /CancelApiTransaction` | oAuth ile başlatılan işlemi iptal eder | oAuth işlem iptali |
| `CheckIBANNumber` | `POST /CheckIBANNumber` | IBAN geçerlilik kontrolü | Hedef hesap doğrulama (201002 önleme) |

#### 2.2.4 Platformda Kullanılmayacak Olan Kategoriler

Credit, Credit Card, DDS, Deposit Accounts, ECommerceLoan, Factoring, Fast, Fast Credit, Invoice, POS, Producer Card, RetailCredit, Tax kategorilerindeki endpoint'ler bu platformun kapsamı **dışındadır**. Ancak `DenizBankBaseClient` generic olduğu için, ileride bu endpoint'ler yalnızca tip tanımı + tek satırlık metot eklenerek desteklenebilir — mimari bunu mümkün kılar.

### 2.3 Bilinen Hata Kodları ve Platform Davranışları

| Kod | Anlam | Platform Davranışı |
|---|---|---|
| `201001` | Account not found | Yapılandırma hatası olarak işaretlenir; admin'e uyarı. **Retry edilmez.** |
| `201002` | Invalid IBAN number | İstek reddi; kullanıcıya doğrulama hatası. **Retry edilmez.** |
| `201003` | Error retrieving account information | Geçici kabul edilir; **exponential backoff ile retry** (maks. 3). |
| `201004` | Start and end date range too much | Sorgu penceresi küçültülerek (30 gün) otomatik yeniden denenir. |
| `201005` | Start date cannot be larger than end date | Programatik hata; loglanır, **retry edilmez.** |
| `500201` | Your account balance is insufficient | Emir `REJECTED` durumuna geçer; bakiye senkronizasyonu tetiklenir. **Retry edilmez.** |
| `90004` | Inadequate transaction limit — mesaj içinde günlük limit ve kalan limit formatlı gelir (`daily transaction limit{0:#,##0.00} TL, remaining available limit {1:#,##0.00} TL`) | Emir `REJECTED`; mesaj parse edilerek admin panelinde limit göstergesi güncellenir. **Retry edilmez.** |
| `90012` | This process is currently closed for use | Servis kapalı; emir `PENDING` kalır, bir sonraki denetim döngüsünde tekrar denenir (maks. deneme sayısına kadar). |
| `90020` | Mesai saatleri dışı işlem kısıtı (`You cannot perform this operation on work days except for {0} to {1}`) | Emir motoru **mesai penceresi kontrolü** ile bu hatayı baştan önler; yine gelirse emir `PENDING`'e alınır ve mesai açılışında yeniden denenir. |
| `1912201233` | Güvenlik nedeniyle işlem iptal | Emir `REJECTED`; kritik uyarı, admin onayı gerektirir. **Retry edilmez.** |
| `20502` | Accounting Error received | Emir `FAILED`; mutabakat (`GetTransactionDetail`) ile nihai durum doğrulanır. |
| `6066` | Recurring wire transfer | Transfer bağlamında geçersiz istek; **retry edilmez.** |
| `30679` | Receiver Account not found | Hedef hesap hatası; **retry edilmez.** |
| `60` | The destination account is invalid | Hedef hesap hatası; **retry edilmez.** |
| `7895` | Toplu ödeme genel hata zarfı — `errNone` / `errSecurity` / `errQuery` / `errLoad` / `errResponse` / `errRecInsert` / `errFormat` / `errValue` alt tipleri | Alt tip parse edilerek loglanır; `errResponse`/`errLoad` geçici kabul edilip retry edilir, diğerleri kalıcı hata. |

**Retry sınıflandırması (istemci tasarımının temeli):**

- **Yeniden denenebilir (transient):** ağ hataları, timeout, HTTP 5xx, `201003`, `errResponse`, `errLoad`
- **Yeniden denemez (permanent):** bakiye/limit/hesap hataları (`500201`, `90004`, `201001`, `201002`, `30679`, `60`), doğrulama hataları
- **Ertelenir (deferred):** `90012`, `90020` — emir `PENDING` kalır, koşul ortadan kalkınca denetim döngüsü yeniden dener

### 2.4 Örnek İstek/Yanıt Akışı — Canlı Emir Gerçekleştirme

```
1) Emir motoru kararı üretir (BUY, sembol: USD, tutar: 10.000 TL)
2) Guard zinciri:
   POST /CheckChangeExchangeReservationDailyVolume  → limit uygun mu?
   POST /GetCurrencyRateList                        → güncel kur
   POST /GetKgvInfo                                 → KGV maliyeti
3) İşlem:
   POST /ChangeExchange
   Parameters: [{
     "TransactionType": "USD",     // ALIM: alınacak döviz cinsi
     "Amount": 10000.00,           // ALIM: TL tutarı
     "ConvertedAmount": 345.67,    // ALIM: alınacak USD tutarı (kur ile hesaplandı)
     ...                           // hesap/kur rezervasyon parametreleri
   }]
4) Mutabakat:
   POST /GetTransactionDetail (TransactionID + SessionID)
   → başarılı: Order.status = FILLED
   → başarısız: Order.status = FAILED/REJECTED + hata kodu kaydı
5) Doğrulama:
   POST /GetAccountList / GetAccountTransactionList → bakiye/hareket senkronizasyonu
```

> **Kritik tasarım kuralı:** `ChangeExchange` çağrısı **timeout veya yanıt alınamadan koparsa**, emir asla `FAILED` yapılmaz; `PENDING_RECONCILIATION` durumuna alınır ve yalnızca `GetTransactionDetail` mutabakatı nihai durumu belirler. Aynı emir, mutabakat tamamlanmadan tekrar gönderilmez (idempotency).

---

## 3. Sistem Mimarisi

### 3.1 Mimari Diyagram (Katmanlı Genel Bakış)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SUNUCU DIŞI / İSTEMCİ                              │
│                                                                             │
│   Tarayıcı (Admin + Kullanıcı Arayüzü)                                      │
│   Next.js App Router · React 19 · Tailwind CSS 4 · Lucide Icons              │
│   TradingView Lightweight Charts                                             │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS (Server Actions / Route Handlers)
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                        SUNUM + API KATMANI (src/app)                         │
│                                                                             │
│  (dashboard)   (stocks)   (portfolio)   (orders)   (news)   (admin)         │
│      │            │            │            │          │         │           │
│      └────────────┴─────┬──────┴────────────┴──────────┴─────────┘           │
│                         │                                                   │
│  app/api/cron/*  ───────┤   Zamanlanmış görevler (Vercel Cron / systemd)    │
│  app/api/admin/* ───────┤   Admin işlemleri (mod anahtarı, ayarlar)          │
└─────────────────────────┼───────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                    HİZMET KATMANI (src/server/services)                      │
│                                                                             │
│  OrderService        Emir yaşam döngüsü, durum makinesi, idempotency         │
│  PortfolioService    Pozisyon açma/kapama, ortalama maliyet, P/L hesabı      │
│  StockService        Hisse/izleme listesi yönetimi, fiyat kayıt tetikleme    │
│  NewsService         Haber toplama orkestrasyonu, dedup, hisse eşleştirme    │
│  AnalysisService     LLM analiz orkestrasyonu, Zod doğrulama, log kaydı      │
│  TradingEngine       Otomatik al/sat karar motoru (kural + analiz birleşimi) │
│  RiskService         Stop-loss/take-profit/limit denetimi, pozisyon guard'ı  │
│  ReconciliationSvc   Mutabakat: PENDING_RECONCILIATION emirlerin nihai durumu│
│  SettingsService     AdminSettings okuma/yazma, önbellek invalidasyonu       │
│  AccountService      Sanal/canlı bakiye senkronizasyonu ve hareket kaydı     │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │ (yalnızca arayüzler üzerinden)
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                   SAĞLAYICI KATMANI (src/server/providers)                   │
│                                                                             │
│  ┌─ TradingProvider (Strategy Pattern) ──────────────────────────────────┐  │
│  │  ITradingProvider                                                     │  │
│  │   ├── PaperTradingProvider   → simülasyon (DB üzerinde sanal bakiye)  │  │
│  │   └── LiveTradingProvider    → DenizBankLiveAdapter                   │  │
│  │                                     └── DenizBankBaseClient           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  IStockPriceProvider ──── BigParaHisseProvider (varsayılan)                 │
│  ILlmProvider ───────────┬─ GeminiLlmProvider (@google/generative-ai)       │
│  │                       └─ OpenAiLlmProvider (openai)                      │
│  INewsScraper ───────────┬─ GoogleNewsScraper (varsayılan)                   │
│  │                       └─ (ek kaynaklar: RSS/HTML scraper'lar)           │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                     VERİ ERİŞİMİ (src/server/db/prisma.ts)                   │
│                     Prisma Client — PostgreSQL                              │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                              DIŞ SİSTEMLER                                   │
│                                                                             │
│  DenizBank API Market (POST, Header+Parameters zarfı, taze GUID/istek)       │
│  Google Gemini API · OpenAI API · Hisse fiyat kaynağı · Haber kaynakları    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Modül Sınırları ve Bağımlılık Kuralı

Bağımlılıklar **her zaman içe doğru** akar (Clean Architecture):

```
app (UI)  →  services  →  providers  →  dış sistemler
    │             │
    └──────┬──────┘
           ▼
        Prisma/DB
```

- `src/app` yalnızca `src/server/services` içindeki servisleri çağırır; **asla doğrudan provider veya Prisma'ya dokunmaz** (cron route'ları da servis üzerinden çalışır).
- `src/server/services` yalnızca **arayüzler** (`ITradingProvider`, `ILlmProvider`…) üzerinden provider katmanını kullanır; somut sınıfları import etmez. Somut sınıf seçimi `src/server/providers/registry.ts` içindeki fabrika fonksiyonlarıyla yapılır.
- `src/server/providers` Prisma'yı **kullanmaz**; kalıcı veri yazımı servis katmanının sorumluluğudur. (Tek istisna: `DenizBankBaseClient` ham istek/yanıt loglarını `ApiCallLog` tablosuna, kendisine enjekte edilen `logApiCall()` helper'ı üzerinden yazar — helper servis katmanına aittir.)
- Dış HTTP çağrıları yalnızca provider katmanında yapılır.

### 3.3 Çift Modlu Ticaret Mimarisi (Strategy Pattern)

```
                    ┌──────────────────────┐
                    │   ITradingProvider   │  (arayüz sözleşmesi)
                    └──────────┬───────────┘
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌───────────────────────────┐     ┌──────────────────────────────────┐
│   PaperTradingProvider    │     │      LiveTradingProvider         │
│───────────────────────────│     │──────────────────────────────────│
│ • Sanal bakiye (Account)  │     │ • DenizBankLiveAdapter kullanır │
│ • Sanal kur (PriceHistory) │     │ • Guard zinciri: limit/kur/KGV  │
│ • DB transaction içinde   │     │ • Mutabakat zorunlu              │
│   anında "FILLED"         │     │ • PENDING_RECONCILIATION akışı   │
│ • Sıfır dış çağrı         │     │ • Hata kodu sınıflandırma        │
└───────────────────────────┘     └──────────────────────────────────┘
```

**Mod geçişi akışı:**

1. Admin panelinde "Sanal → Canlı" anahtarı çevrilir.
2. `SettingsService.setTradingMode("LIVE")` çağrılır.
3. Servis, `PENDING` veya `PENDING_RECONCILIATION` durumunda emir varsa geçişi **reddeder** (veri tutarlılığı için tüm emirler nihai durumda olmalı).
4. `AdminSettings.tradingMode` güncellenir; `getTradingProvider()` fabrikası bir sonraki çağrıda `LiveTradingProvider` döner.
5. Canlı moda ilk geçişte zorunlu onay: admin, risk parametrelerini gördüğü onay diyaloğunu onaylar (`AdminSettings.liveModeConfirmedAt` damgası).

**Aynı arayüz, iki gerçeklik:** `OrderService`, hangi modda olduğunu bilmez; `ITradingProvider.executeOrder()` sonucunu bekler. Böylece emir durum makinesi, portföy güncellemesi ve raporlama kodu **tek** kalır.

### 3.4 Otomatik Al/Sat Motoru — Karar Akışı

```
[Cron: analiz döngüsü — gün içinde periyodik]
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. NewsService.scanDailyNews()                                │
│    • Kaynaklardan haber çek · URL hash ile dedup              │
│    • Hisse sembolleriyle eşleştir (başlık + içerik)           │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. AnalysisService.runAnalysisForStock(symbol)                │
│    • Girdi: son N haber + son fiyat geçmişi + mevcut pozisyon │
│    • Prompt: AdminSettings.systemPrompt (dinamik, UI'dan)     │
│    • ILlmProvider.analyze() → ham metin                       │
│    • Zod şemasıyla doğrula → AiAnalysisLog kaydı              │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. TradingEngine.evaluate(analysis, portfolio, settings)      │
│    Karar kuralları (hepsi geçmek ZORUNDA):                    │
│    a) action == BUY|SELL                                       │
│    b) confidence >= minConfidenceThreshold                     │
│    c) mesai penceresi içinde (90020 önleme)                   │
│    d) pozisyon limitleri: maxOpenPositions, maxPositionValue  │
│    e) RiskService: stop-loss/take-profit tetikleri önce        │
│    f) günlük emir bütçesi aşılmamış                            │
│    g) cooldown: aynı sembol için son analizden min süre geçmiş │
└──────────────────────┬───────────────────────────────────────┘
                       ▼ (tüm kurallar geçildiyse)
┌──────────────────────────────────────────────────────────────┐
│ 4. OrderService.createAndExecuteOrder(...)                    │
│    • Order kaydı (PENDING) + clientRequestId (idempotency)    │
│    • ITradingProvider.executeOrder()                          │
│    • Sonuç → durum makinesi güncellemesi                      │
└──────────────────────────────────────────────────────────────┘
```

### 3.5 Emir Durum Makinesi

```
                    ┌──────────┐
   createOrder ───▶ │ PENDING  │
                    └────┬─────┘
                         │ executeOrder()
        ┌────────────────┼─────────────────────┐
        ▼                ▼                     ▼
┌──────────────┐  ┌─────────────┐   ┌───────────────────────────┐
│  EXECUTING   │  │  REJECTED   │   │ PENDING_RECONCILIATION    │
│ (canlı: API  │  │ (kalıcı hata│   │ (timeout / yanıt yok)    │
│  çağrısı     │  │  500201,    │   │  → GetTransactionDetail  │
│  sürüyor)    │  │  90004 vb.) │   │    ile nihai durum)      │
└──────┬───────┘  └─────────────┘   └───────────┬───────────────┘
       │                                       │ mutabakat
       ▼                            ┌──────────┴──────────┐
┌──────────────┐                    ▼                     ▼
│    FILLED    │◀────────────  ┌─────────┐         ┌───────────┐
│ (tamamlandı, │               │ SUCCESS │         │  FAILED   │
│  pozisyon    │               └─────────┘         └───────────┘
│  güncellendi)│
└──────┬───────┘
       │ admin iptali / risk kuralı
       ▼
┌──────────────┐
│   CANCELLED  │
└──────────────┘
```

**Durum geçiş kuralları (Prisma enum `OrderStatus`):**

| Geçiş | İzin veren |
|---|---|
| `PENDING → EXECUTING` | `OrderService` (emir gönderimi başlarken) |
| `EXECUTING → FILLED` | Provider başarısı + (canlıda) mutabakat onayı |
| `EXECUTING → REJECTED` | Kalıcı hata kodu (bakiye, limit, doğrulama) |
| `EXECUTING → PENDING_RECONCILIATION` | Timeout / ağ kopması / belirsiz sonuç |
| `PENDING_RECONCILIATION → FILLED \| FAILED` | **Yalnızca** `ReconciliationService` (GetTransactionDetail) |
| `PENDING → CANCELLED` | Admin (emir henüz gönderilmediyse) |
| `FILLED → CANCELLED` | **Yasaktır** — dolu emir iptal edilmez; ters yönde yeni emir açılır |

### 3.6 Veri Akışı — Örnek Senaryo (Haber → Analiz → Emir → Mutabakat)

```
Haber kaynağı ──▶ NewsService ──▶ NewsArticle (DB)
                                     │
                                     ▼ (cron tetiklemesi)
                              AnalysisService
                                     │  prompt + haberler + fiyatlar
                                     ▼
                              ILlmProvider (Gemini|OpenAI)
                                     │  ham yanıt
                                     ▼
                              Zod doğrulama ──▶ AiAnalysisLog (DB)
                                     │  action=BUY, confidence=0.82
                                     ▼
                              TradingEngine.evaluate()
                                     │  tüm guard'lar geçildi
                                     ▼
                              OrderService ──▶ Order (PENDING)
                                     │
                                     ▼
                        getTradingProvider() ──┬── Paper: DB'de FILLED
                                              │
                                              └── Live: DenizBankLiveAdapter
                                                        │
                                                        ▼
                                             DenizBankBaseClient.post()
                                                        │ Header+Parameters
                                                        ▼
                                             DenizBank API Market
                                                        │
                                     ┌──────────────────┴───────────────┐
                                     ▼                                  ▼
                              yanıt alındı                        timeout/kopma
                                     │                                  │
                          ┌──────────┴─────────┐              PENDING_RECONCILIATION
                          ▼                    ▼                        │
                     Data başarılı        hata kodu                      ▼
                          │                    │              ReconciliationService
                          ▼                    ▼              GetTransactionDetail
                       FILLED              REJECTED/FAILED          │
                          │                                         ▼
                          ▼                              FILLED | FAILED
                   PortfolioService
                   (pozisyon + bakiye güncelle)
                          │
                          ▼
                    UI (canlı yenileme)
```

---

## 4. Çekirdek Arayüz ve Sınıf Tasarımları

> Bu bölümdeki TypeScript imzaları **uygulanmaya hazır sözleşmelerdir**. Dosya yolları Bölüm 6'daki dizin yapısıyla birebir eşleşir.

### 4.1 Ortak Tipler (`src/server/providers/trading/types.ts`)

```typescript
import type { Prisma } from "@prisma/client";

/** Ticaret modu — AdminSettings.tradingMode ile birebir eşleşir. */
export type TradingMode = "PAPER" | "LIVE";

/** Emir yönü — LLM action çıktısı ve emir tarafında ortaktır. */
export type OrderSide = "BUY" | "SELL";

/** Emir durum makinesi — Prisma OrderStatus enum'ıyla senkron tutulur. */
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

/** Para birimleri — DenizBank TransactionType değerleriyle uyumlu. */
export type CurrencyCode = "TRY" | "USD" | "EUR" | "GBP" | "CHF" | "JPY" | "AUD" | "CAD";

/** Emir gerçekleştirme isteği — OrderService → Provider arası sözleşme. */
export interface ExecuteOrderRequest {
  /** Order tablosundaki kayıt — provider yalnızca okur, durumunu kendisi yazmaz. */
  orderId: string;
  /** Idempotency anahtarı: aynı emrin tekrar gönderilmesini banka tarafında da önler. */
  clientRequestId: string;
  side: OrderSide;
  assetType: AssetType;
  /** Hisse sembolü (örn. "THYAO") veya döviz kodu (örn. "USD"). */
  symbol: string;
  /** İşlem gören miktar: hisse adedi veya döviz tutarı. */
  quantity: Prisma.Decimal;
  /** Emrin verildiği para birimi (hisse: TRY; döviz: TRY tarafı). */
  currency: CurrencyCode;
  /** Beklenen fiyat — canlı modda bilgilendirme amaçlı; sapma guard'ında kullanılır. */
  limitPrice?: Prisma.Decimal;
  /** Emri üreten analiz kaydı (varsa) — izlenebilirlik için provider'a taşınır. */
  analysisLogId?: string;
}

/** Emir gerçekleştirme sonucu — provider'dan servise dönen sözleşme. */
export interface ExecuteOrderResult {
  /** Nihai durum makinesi güncellemesi. */
  status: OrderStatus;
  /** Gerçekleşen miktar (slippage/kur farkı olabilir). */
  filledQuantity: Prisma.Decimal;
  /** Gerçekleşen toplam maliyet/getiri (quantity × fiyat + masraflar). */
  filledValue: Prisma.Decimal;
  /** Birim gerçekleşme fiyatı. */
  avgPrice?: Prisma.Decimal;
  /** Banka işlem referansı — mutabakat ve dekont için. */
  transactionId?: string;
  /** DenizBank ChannelSessionId — GetTransactionDetail mutabakatında kullanılır. */
  sessionId?: string;
  /** Banka hata kodu (örn. 500201, 90004). */
  errorCode?: string;
  /** Banka/istekci hata mesajı — kullanıcıya gösterilecek haliyle. */
  errorMessage?: string;
  /** Kalıcı hata mı (retry anlamsız) yoksa geçici mi? */
  isRetryable: boolean;
  /** Ham API yanıtı — ApiCallLog'a yazılmak üzere. */
  rawResponse?: unknown;
}

/** Sağlayıcı sağlık durumu — admin paneli göstergesi. */
export interface ProviderHealth {
  mode: TradingMode;
  /** Son başarılı çağrı zamanı. */
  lastSuccessAt?: Date;
  /** Son hata (varsa). */
  lastError?: { code: string; message: string; at: Date };
  /** Canlı modda DenizBank erişilebilirliği (GetAccountList ping). */
  bankReachable?: boolean;
}
```

### 4.2 `ITradingProvider` Arayüzü (`src/server/providers/trading/ITradingProvider.ts`)

```typescript
import type { Prisma } from "@prisma/client";
import type {
  CurrencyCode,
  ExecuteOrderRequest,
  ExecuteOrderResult,
  ProviderHealth,
  TradingMode,
} from "./types";

/** Sağlayıcıdan çekilebilen bakiye bilgisi. */
export interface BalanceInfo {
  /** Para birimi. */
  currency: CurrencyCode;
  /** Kullanılabilir bakiye (bloke hariç). */
  available: Prisma.Decimal;
  /** Toplam bakiye. */
  total: Prisma.Decimal;
}

/** Kur bilgisi — GetCurrencyRateList yanıtının normalize edilmiş hali. */
export interface CurrencyRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  /** Banka alış kuru (banka döviz alırken uyguladığı). */
  bid: Prisma.Decimal;
  /** Banka satış kuru (banka döviz satarken uyguladığı). */
  ask: Prisma.Decimal;
  fetchedAt: Date;
}

/**
 * Ticaret sağlayıcısı sözleşmesi — Strategy Pattern.
 *
 * İki implementasyon:
 *  - PaperTradingProvider: DB üzerinde simülasyon, sıfır dış çağrı.
 *  - LiveTradingProvider:  DenizBank API Market üzerinden gerçek işlem.
 *
 * INVARIANT'LAR (her implementasyon bu kurallara uyar):
 *  1. executeOrder() asla Order tablosunun durumunu doğrudan YAZMAZ;
 *     sonucu döner, durum güncellemesi OrderService'in sorumluluğudur.
 *  2. executeOrder() idempotent'tir: aynı clientRequestId ile ikinci çağrı
 *     ilk sonucu (veya "zaten işlendi" bilgisini) döner, yeni işlem üretmez.
 *  3. Belirsiz sonuçta (timeout) status = PENDING_RECONCILIATION döner;
 *     asla FAILED dönmez — nihai karar mutabakat servisine aittir.
 *  4. Tüm parasal alanlar Prisma.Decimal'dır; Number'a çevrim yapılmaz.
 */
export interface ITradingProvider {
  /** Sağlayıcının çalıştırdığı mod. */
  readonly mode: TradingMode;

  /**
   * Emri gerçekleştirir.
   * Paper modda: DB transaction içinde anlık FILLED simülasyonu.
   * Live modda: guard zinciri (limit→kur→KGV) + ChangeExchange + mutabakat.
   */
  executeOrder(request: ExecuteOrderRequest): Promise<ExecuteOrderResult>;

  /** Belirtilen para biriminde kullanılabilir bakiyeyi döner. */
  getBalance(currency: CurrencyCode): Promise<BalanceInfo>;

  /** Güncel kur listesini döner (döviz işlemleri için). */
  getCurrencyRates(): Promise<CurrencyRate[]>;

  /**
   * Emrin banka tarafındaki nihai durumunu sorgular.
   * Paper modda: DB'den okur (her zaman kesin).
   * Live modda: GetTransactionDetail (TransactionID + SessionID) çağırır.
   */
  getOrderStatus(transactionId: string, sessionId: string): Promise<ExecuteOrderResult>;

  /** Sağlayıcı sağlık göstergesi — admin paneli ve cron denetimi için. */
  getHealth(): Promise<ProviderHealth>;
}
```

### 4.3 `PaperTradingProvider` (`src/server/providers/trading/PaperTradingProvider.ts`)

```typescript
import type { ITradingProvider } from "./ITradingProvider";

/**
 * Sanal ticaret sağlayıcısı.
 *
 * Davranış sözleşmesi:
 *  - Tüm işlemler tek bir Prisma transaction içinde atomik yürütülür:
 *    (bakiye kontrolü → bakiye düşümü → pozisyon güncelleme → hareket kaydı).
 *  - Bakiye yetersizse REJECTED döner (canlıdaki 500201 semantiği).
 *  - Kur, PriceHistory tablosundaki en güncel kayıttan okunur.
 *  - executeOrder() başarılıysa status = FILLED döner; mutabakat gerektirmez.
 *  - getOrderStatus() her zaman DB gerçeğini döndürür (simülasyonda belirsizlik yoktur).
 */
export class PaperTradingProvider implements ITradingProvider {
  readonly mode = "PAPER" as const;

  constructor(
    /** Sanal hesap kayıtlarına erişim — servis katmanı enjekte eder. */
    private readonly accountRepo: PaperAccountRepositoryPort,
    /** Kur okuma portu — PriceHistory üzerinden. */
    private readonly rateSource: RateSourcePort,
  ) {}

  async executeOrder(request: ExecuteOrderRequest): Promise<ExecuteOrderResult>;
  async getBalance(currency: CurrencyCode): Promise<BalanceInfo>;
  async getCurrencyRates(): Promise<CurrencyRate[]>;
  async getOrderStatus(transactionId: string, sessionId: string): Promise<ExecuteOrderResult>;
  async getHealth(): Promise<ProviderHealth>;
}
```

### 4.4 `LiveTradingProvider` (`src/server/providers/trading/LiveTradingProvider.ts`)

```typescript
import type { ITradingProvider } from "./ITradingProvider";
import type { DenizBankLiveAdapter } from "../denizbank/DenizBankLiveAdapter";

/**
 * Canlı ticaret sağlayıcısı — DenizBank API Market adaptörü.
 *
 * Davranış sözleşmesi:
 *  - executeOrder() öncesi guard zinciri çalışır:
 *      1. CheckChangeExchangeReservationDailyVolume → günlük limit uygun mu?
 *      2. GetCurrencyRateList → güncel kur + limitPrice sapma kontrolü
 *      3. GetKgvInfo → KGV maliyeti net tutara dahil edilir
 *  - Guard'ların herhangi biri başarısızsa emir bankaya HİÇ GÖNDERİLMEZ;
 *    REJECTED döner (errorCode ile).
 *  - ChangeExchange çağrısı DenizBankLiveAdapter.changeExchange() üzerinden yapılır;
 *    Amount/ConvertedAmount asimetrisi adaptörde kapsüllenmiştir.
 *  - Yanıt alınırsa GetTransactionDetail ile mutabakat yapılır ve nihai durum döner.
 *  - Timeout/kopmada PENDING_RECONCILIATION döner; emir asla FAILED yapılmaz.
 *  - 90012/90020 hatalarında "deferred" bilgisi döner; OrderService emri
 *    PENDING'te tutar ve denetim döngüsü koşul ortadan kalkınca tekrar dener.
 */
export class LiveTradingProvider implements ITradingProvider {
  readonly mode = "LIVE" as const;

  constructor(
    /** DenizBank operasyonel adaptörü — tüm banka çağrıları buradan geçer. */
    private readonly bank: DenizBankLiveAdapter,
    /** Guard'ların okuyacağı risk ayarları portu. */
    private readonly riskSettings: RiskSettingsPort,
  ) {}

  async executeOrder(request: ExecuteOrderRequest): Promise<ExecuteOrderResult>;
  async getBalance(currency: CurrencyCode): Promise<BalanceInfo>;
  async getCurrencyRates(): Promise<CurrencyRate[]>;
  async getOrderStatus(transactionId: string, sessionId: string): Promise<ExecuteOrderResult>;
  async getHealth(): Promise<ProviderHealth>;
}
```

### 4.5 Sağlayıcı Fabrikası (`src/server/providers/registry.ts`)

```typescript
import type { ITradingProvider } from "./trading/ITradingProvider";
import type { TradingMode } from "./trading/types";

/**
 * Çalışma zamanı sağlayıcı seçimi — mod anahtarının kod karşılığı.
 *
 * Her istekte AdminSettings.tradingMode okunur (SettingsService önbelleğiyle);
 * mod değiştiğinde yeni provider örneği döner. Provider örnekleri durum tutmaz
 * (stateless) — yarım kalan işlemler ReconciliationService tarafından DB
 * üzerinden tamamlanır; tüm durum veritabanındadır.
 */
export function getTradingProvider(mode: TradingMode): ITradingProvider;

/** Mevcut AdminSettings'ten modu okuyup provider döndüren kısayol. */
export function resolveTradingProvider(): Promise<ITradingProvider>;

/** LLM sağlayıcı seçimi — AdminSettings.aiProvider + apiKey'a göre. */
export function resolveLlmProvider(): Promise<ILlmProvider>;

/** Haber kaynaklarını AdminSettings.newsSources'a göre kurar. */
export function resolveNewsScrapers(): Promise<INewsScraper[]>;
```

### 4.6 `DenizBankBaseClient` (`src/server/providers/denizbank/DenizBankBaseClient.ts`)

```typescript
import type { ZodType } from "zod";

/**
 * DenizBank API Market generic istemcisi.
 *
 * Sözleşme kuralları (docs/DenizBank API Market Download.txt):
 *  - Tüm endpoint'ler POST + application/json.
 *  - Her istek: { Header: {...}, Parameters: [ ... ] } zarfı.
 *  - Header: AppKey (env), Channel="API", ChannelSessionId (taze GUID),
 *    ChannelRequestId (taze GUID) — her istekte yeniden üretilir.
 *  - Yanıt: { Data: object } — HTTP 200 ≠ başarı; Data içeriği denetlenir.
 *
 * Tasarım ilkeleri:
 *  - Endpoint'ler tip güvenli: her endpoint'in Parameters şeması Zod ile
 *    tanımlanır; yanıt şeması da Zod ile doğrulanır (banka sözleşmesi
 *    değişirse derleme değil, çalışma zamanı doğrulaması yakalar).
 *  - Retry: yalnızca "transient" sınıfındaki hatalarda (ağ, timeout, 5xx,
 *    201003, errResponse, errLoad) exponential backoff (1s, 2s, 4s; jitter'lı).
 *    Kalıcı hatalarda (bakiye, limit, doğrulama) retry YASAK.
 *  - Timeout: varsayılan 30 sn; para hareketi içeren çağrılarda 45 sn.
 *  - Her çağrının ham istek/yanıtı logApiCall() ile ApiCallLog'a yazılır
 *    (AppKey maskelemeli) — mutabakat ve denetim izi için.
 *  - GUID üretimi Node crypto.randomUUID() ile; uuid paketine gerek yok.
 */
export class DenizBankBaseClient {
  constructor(
    config: {
      /** Banka temel URL'i — DENIZBANK_BASE_URL env'inden. */
      baseUrl: string;
      /** Uygulama anahtarı — DENIZBANK_APP_KEY env'inden. Asla koda gömülmez. */
      appKey: string;
      /** İstek timeout'u (ms). */
      timeoutMs?: number;
      /** Retry politikası: transient hatalarda maksimum deneme sayısı. */
      maxRetries?: number;
    },
    deps: {
      /** Ham istek/yanıt kaydı — ApiCallLog tablosuna yazar. */
      logApiCall: (entry: ApiCallLogEntry) => Promise<void>;
      /** Zod şema doğrulayıcı — endpoint bazlı şemalarla çalışır. */
      validate: <T>(schema: ZodType<T>, payload: unknown) => T;
    },
  ) {}

  /**
   * Zarfı (envelope) kurar: Header (taze GUID'lerle) + Parameters.
   * Her çağrıda ChannelSessionId ve ChannelRequestId yeniden üretilir —
   * bu, dokümanın "Her istekte farklı GUID değerler girilmeli" kuralıdır.
   */
  private buildEnvelope<TParams>(parameters: TParams[]): DenizBankEnvelope<TParams>;

  /**
   * Endpoint çağrısı — tüm tip güvenliği ve hata sınıflandırma burada.
   *
   * @param endpoint       URL segmenti (örn. "GetAccountList")
   * @param paramsSchema   Parameters dizisi öğelerinin Zod şeması
   * @param responseSchema Data alanının Zod şeması
   * @param parameters     Gönderilecek parametre nesneleri
   * @param options        Çağrı seçenekleri
   */
  async call<TParams, TData>(
    endpoint: string,
    paramsSchema: ZodType<TParams>,
    responseSchema: ZodType<TData>,
    parameters: TParams[],
    options?: {
      /** Para hareketi içeren endpoint — timeout uzar, retry daha temkinli. */
      isMoneyMovement?: boolean;
      /** Bu çağrı için retry'ı tamamen devre dışı bırak. */
      disableRetry?: boolean;
    },
  ): Promise<DenizBankResponse<TData>>;

  /**
   * Hata sınıflandırıcı — Bölüm 2.3'teki tabloyu koda çevirir.
   * Dönen sınıf: "TRANSIENT" (retry), "PERMANENT" (retry yok),
   * "DEFERRED" (mesai/servis kapalı — PENDING kal), "UNKNOWN" (mutabakat).
   */
  private classifyError(httpStatus: number, data: unknown): DenizBankErrorClass;

  /** Exponential backoff + jitter — transient hatalarda denemeler arası bekleme. */
  private backoff(attempt: number): Promise<void>;
}

/** Zarf tipi — dokümandaki yapıyla birebir. */
export interface DenizBankEnvelope<TParams> {
  Header: {
    AppKey: string;
    Channel: "API";
    ChannelSessionId: string; // crypto.randomUUID()
    ChannelRequestId: string; // crypto.randomUUID()
  };
  Parameters: TParams[];
}

/** Yanıt zarfı — Data içeriği endpoint'e özgü. */
export interface DenizBankResponse<TData> {
  Data: TData;
  /** Sınıflandırılmış hata (varsa) — servis katmanı buna göre karar verir. */
  error?: {
    code: string;
    message: string;
    class: DenizBankErrorClass;
  };
}

export type DenizBankErrorClass = "TRANSIENT" | "PERMANENT" | "DEFERRED" | "UNKNOWN";
```

### 4.7 `DenizBankLiveAdapter` (`src/server/providers/denizbank/DenizBankLiveAdapter.ts`)

```typescript
import type { Prisma } from "@prisma/client";

/**
 * Operasyonel DenizBank adaptörü — platformun ihtiyaç duyduğu endpoint'leri
 * tip güvenli metotlar olarak sunar. Her metot, BaseClient.call() üzerine
 * ince bir tip katmanıdır; iş kuralı içermez (iş kuralları servis katmanında).
 */
export class DenizBankLiveAdapter {
  constructor(private readonly client: DenizBankBaseClient) {}

  /** POST /GetAccountList — hesap listesi (bakiye senkronizasyonu). */
  async getAccountList(params: GetAccountListParams): Promise<GetAccountListData>;

  /** POST /GetAccountDetail — tek hesap detayı. */
  async getAccountDetail(params: GetAccountDetailParams): Promise<GetAccountDetailData>;

  /** POST /GetAccountTransactionList — hesap hareketleri (parçalı tarih penceresi). */
  async getAccountTransactionList(
    params: GetAccountTransactionListParams,
  ): Promise<GetAccountTransactionListData>;

  /** POST /GetCurrencyRateList — güncel kur listesi. */
  async getCurrencyRateList(params: GetCurrencyRateListParams): Promise<GetCurrencyRateListData>;

  /** POST /GetKgvInfo — Kambiyo Gider Vergisi bilgisi. */
  async getKgvInfo(params: GetKgvInfoParams): Promise<GetKgvInfoData>;

  /** POST /CheckChangeExchangeReservationDailyVolume — günlük döviz limit kontrolü. */
  async checkDailyVolume(params: CheckDailyVolumeParams): Promise<CheckDailyVolumeData>;

  /** POST /GetRateReservationParameter — kur rezervasyon parametreleri. */
  async getRateReservationParameter(
    params: RateReservationParams,
  ): Promise<RateReservationData>;

  /**
   * POST /ChangeExchange — döviz alım-satım işlemi.
   *
   * KRİTİK İŞ KURALI (dokümandan):
   *  - SATIŞ: TransactionType = satılacak döviz, Amount = döviz tutarı,
   *            ConvertedAmount = TL karşılığı.
   *  - ALIM:  TransactionType = alınacak döviz, Amount = TL tutarı,
   *           ConvertedAmount = alınacak döviz tutarı.
   * Bu asimetri buildChangeExchangeParams() içinde kapsüllenir.
   */
  async changeExchange(params: ChangeExchangeParams): Promise<ChangeExchangeData>;

  /** POST /GetTransactionDetail — TransactionID + SessionID mutabakatı. */
  async getTransactionDetail(
    params: GetTransactionDetailParams,
  ): Promise<GetTransactionDetailData>;

  /** POST /GetReceiptData — dekont verisi. */
  async getReceiptData(params: GetReceiptDataParams): Promise<GetReceiptDataData>;

  /** POST /CheckIBANNumber — IBAN doğrulama. */
  async checkIbanNumber(params: CheckIbanParams): Promise<CheckIbanData>;

  /**
   * ChangeExchange parametre kurucu — alım/satış asimetrisinin TEK merkezi.
   * Yanlış yön eşlemesi, tüm birim testlerinin ilk hedefidir.
   */
  private buildChangeExchangeParams(input: {
    side: "BUY" | "SELL";
    currency: string;
    /** Döviz cinsinden işlem miktarı. */
    fxAmount: Prisma.Decimal;
    /** TL karşılığı. */
    tryAmount: Prisma.Decimal;
    /** İşlem yapılan hesap. */
    accountNumber: string;
  }): ChangeExchangeParams;
}
```

### 4.8 LLM Sağlayıcı Arayüzü (`src/server/providers/llm/ILlmProvider.ts`)

```typescript
import type { Prisma } from "@prisma/client";

/** Analiz istemi — AnalysisService tarafından hazırlanır. */
export interface AnalysisPromptInput {
  /** Analiz edilen hisse sembolü. */
  symbol: string;
  /** Son N haber (başlık + özet + tarih), yeniden eskiye. */
  news: { title: string; summary: string; publishedAt: Date; source: string }[];
  /** Son fiyat geçmişi (kapanış serisi). */
  priceHistory: { date: Date; close: Prisma.Decimal }[];
  /** Mevcut pozisyon (varsa): adet, ortalama maliyet. */
  currentPosition?: { quantity: Prisma.Decimal; avgCost: Prisma.Decimal };
  /** Admin panelinden dinamik değiştirilen sistem promptu. */
  systemPrompt: string;
}

/** LLM'den beklenen yapılandırılmış çıktı — Zod ile doğrulanır. */
export interface StructuredAnalysis {
  /** Karar: BUY | SELL | HOLD. */
  action: "BUY" | "SELL" | "HOLD";
  /** Güven skoru: 0.0–1.0. */
  confidence: number;
  /** Kararın gerekçesi — kullanıcıya gösterilir. */
  reasoning: string;
  /** Öne çıkan riskler (opsiyonel). */
  risks?: string[];
}

export interface ILlmProvider {
  /** Sağlayıcı kimliği — AdminSettings.aiProvider değeriyle eşleşir. */
  readonly providerId: "GEMINI" | "OPENAI";

  /**
   * Yapılandırılmış analiz üretir.
   * Sağlayıcı farkı (Gemini responseSchema / OpenAI json mode) burada kapsüllenir;
   * çağıran taraf her zaman aynı StructuredAnalysis sözleşmesini alır.
   */
  analyze(input: AnalysisPromptInput): Promise<StructuredAnalysis>;

  /** Sağlayıcı bağlantı testi — admin paneli "Test Et" düğmesi. */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
```

**Zod doğrulama şeması (`src/lib/schemas/analysis.ts`):**

```typescript
import { z } from "zod";

/**
 * LLM çıktı doğrulama şeması — AiAnalysisLog kaydından emir motoruna
 * giden her analiz bu şemadan geçer. Şema dışı çıktı → analiz FAILED kabul
 * edilir, emir ÜRETİLMEZ, hata AiAnalysisLog.validationError'a yazılır.
 */
export const structuredAnalysisSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(4000),
  risks: z.array(z.string().max(500)).max(10).optional(),
});

export type ValidatedAnalysis = z.infer<typeof structuredAnalysisSchema>;
```

### 4.9 Haber ve Fiyat Sağlayıcı Arayüzleri

```typescript
/** src/server/providers/news/INewsScraper.ts */
export interface INewsScraper {
  /** Kaynak kimliği — AdminSettings.newsSources'ta referans edilir. */
  readonly sourceId: string;
  /** Kaynak görünen adı (admin panelinde listelenir). */
  readonly displayName: string;

  /**
   * Belirtilen sembol/hisse için güncel haberleri çeker.
   * Dedup (URL hash) NewsService tarafından uygulanır; scraper yalnızca
   * ham listeyi döner.
   */
  fetchNews(symbol: string, since: Date): Promise<RawNewsItem[]>;
}

export interface RawNewsItem {
  title: string;
  /** Makale özeti/içeriği (kaynağa göre uzunluk değişir). */
  summary: string;
  url: string;
  publishedAt: Date;
  source: string;
}

/** src/server/providers/stock/IStockPriceProvider.ts */
export interface IStockPriceProvider {
  /** Sağlayıcı kimliği. */
  readonly providerId: string;

  /** Tek hisse için güncel fiyat. */
  getQuote(symbol: string): Promise<StockQuote>;

  /** Birden çok hisse için toplu fiyat (cron verimliliği için). */
  getQuotes(symbols: string[]): Promise<StockQuote[]>;

  /**
   * Dönemsel geçmiş — grafikler ve LLM girdisi için.
   * @param range 1G | 1H | 3A | 1Y | 5Y
   */
  getHistoricalPrices(symbol: string, range: HistoryRange): Promise<StockCandle[]>;
}

export interface StockQuote {
  symbol: string;
  price: Prisma.Decimal;
  change: Prisma.Decimal;        // mutlak değişim
  changePercent: Prisma.Decimal;  // yüzde değişim
  volume?: Prisma.Decimal;
  fetchedAt: Date;
}

export type HistoryRange = "1D" | "1W" | "3M" | "1Y" | "5Y";
```

---
