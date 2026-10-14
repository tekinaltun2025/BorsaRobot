import type { Metadata } from "next";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { HelpToc } from "@/components/help/HelpToc";
import {
  Callout,
  FlowDiagram,
  HelpCard,
  HelpSection,
  InfoTable,
  Screenshot,
  StepList,
  SubSection,
} from "@/components/help/HelpUi";

export const metadata: Metadata = {
  title: "Yardım",
  description:
    "BorsaRobot kullanım rehberi — tüm sistemin çalışma mantığı, ekran ve buton açıklamaları, ekran görüntüleriyle.",
};

/**
 * /yardim — Uygulama içi yardım sayfası (server component).
 *
 * İçerik kaynağı: KULLANIM.md + src/components altındaki gerçek bileşen
 * davranışları. Ekran görüntüleri public/screenshots altından servis edilir.
 */
export default function YardimPage() {
  return (
    <div className="space-y-8">
      {/* Başlık */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <CircleHelp className="h-5 w-5 text-white" aria-hidden />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">Yardım</h1>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-gray-400">
          Bu sayfa, BorsaRobot platformunun tüm sisteminin nasıl çalıştığını;
          her ekranın ve her butonun ne işe yaradığını ekran görüntüleriyle
          açıklar. Soldaki içindekiler listesinden istediğiniz bölüme
          atlayabilirsiniz.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Sticky TOC — masaüstünde sol kolon */}
        <aside aria-label="İçindekiler">
          <HelpToc />
        </aside>

        {/* İçerik */}
        <div className="min-w-0 space-y-12">
          {/* ============ 1. SİSTEM GENEL BAKIŞ ============ */}
          <HelpSection
            id="genel-bakis"
            title="Sistem Genel Bakış"
            description="BorsaRobot, Borsa İstanbul hisselerini takip eden çift modlu (Sanal/Canlı) bir ticaret asistanıdır. Platform; piyasa fiyatı üretimi, haber taraması, AI analizi, emir yönetimi ve portföy takibini uçtan uca birleştirir."
          >
            <FlowDiagram
              steps={[
                "Piyasa fiyatı üretilir (deterministik simülasyon — her tick'te fiyatlar değişir, OHLC mumlar oluşur)",
                "Google News RSS'ten sembol bazlı gerçek haber başlıkları çekilir (aynı URL iki kez kaydedilmez)",
                "Haberler + fiyat geçmişi + pozisyon bilgisi LLM'e (Gemini/OpenAI) gönderilir",
                "LLM yapılandırılmış JSON karar üretir: BUY / SELL / HOLD + güven skoru",
                "Otomatik motor (etkinse) kararı risk kurallarından geçirip emre çevirir",
                "PAPER modda sanal bakiye ile simüle edilir; LIVE modda DenizBank API Market üzerinden gerçek döviz işlemi yapılır",
              ]}
            />

            <InfoTable
              headers={["Özellik", "PAPER (Sanal)", "LIVE (Canlı)"]}
              rows={[
                ["Para", "Sanal bakiye", "Gerçek banka bakiyesi"],
                [
                  "İşlem türü",
                  "Hisse alım/satımı",
                  "Yalnızca döviz (USD/TRY) — DenizBank ChangeExchange",
                ],
                ["Komisyon", "Uygulanır", "Uygulanmaz"],
                [
                  "Otomatik motor",
                  "Çalışır",
                  "Devre dışı (güvenlik gereği asla emir vermez)",
                ],
                [
                  "Emir onayı",
                  "Standart",
                  "Ekstra \u201cCANLI İŞLEM\u201d kutusu + onay damgası",
                ],
                [
                  "Hisse emri",
                  "Desteklenir",
                  "LIVE_STOCK_NOT_SUPPORTED ile reddedilir",
                ],
              ]}
            />

            <Callout tone="info" title="Önemli mimari özellikler">
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  <strong>Fiyatlar simüle edilir:</strong> Gerçek borsa verisi
                  yerine seed'li, deterministik bir piyasa simülatörü
                  çalışır. Fiyatlar yalnızca tick ile değişir.
                </li>
                <li>
                  <strong>Haberler gerçektir:</strong> Google News RSS üzerinden
                  gerçek başlıklar çekilir; URL hash dedup ile tekrarlar
                  engellenir.
                </li>
                <li>
                  <strong>AI analizi yapılandırılmıştır:</strong> LLM yanıtları
                  Zod şemasıyla doğrulanır; geçersiz yanıtta hata geri
                  beslemeli retry çalışır, hatalı yanıt asla emre dönüşmez.
                </li>
                <li>
                  <strong>Canlı mod çok katmanlıdır:</strong> Yanlışlıkla gerçek
                  para harcanmasını önlemek için birden fazla onay katmanı
                  vardır (bkz. Ticaret ve Yönetim bölümleri).
                </li>
              </ul>
            </Callout>
          </HelpSection>

          {/* ============ 2. EKRAN REHBERİ ============ */}
          <HelpSection
            id="ekran-rehberi"
            title="Ekran Rehberi"
            description="Üst navigasyon çubuğundaki her sayfanın amacı, ekrandaki her kartın, tablonun ve butonun ne yaptığı bu bölümde ayrıntılı açıklanmıştır."
          >
            {/* ---- 2.1 Ana Sayfa ---- */}
            <SubSection id="ekran-panel" title="Ana Sayfa" route="/">
              <p className="text-sm leading-relaxed text-gray-300">
                Genel bakış panosudur. Açılışta platforma hoş geldiniz mesajı,
                özet istatistik kartları, izleme listesi özeti ve platform
                yetenekleri kartları gösterilir.
              </p>

              <Screenshot
                src="/screenshots/home.png"
                alt="BorsaRobot Ana Sayfa — istatistik kartları ve yükselenler/düşenler listeleri"
                caption="Ana Sayfa (/): özet kartları, En Çok Yükselenler / En Çok Düşenler listeleri ve Platform Yetenekleri."
              />

              <InfoTable
                headers={["Kart / Buton", "Ne Yapar"]}
                rows={[
                  [
                    "Takip Edilen Hisseler",
                    "Veri tabanında kayıtlı toplam BIST hissesi sayısını gösterir.",
                  ],
                  [
                    "İzleme Listesi",
                    "Aktif takip listenizdeki sembol sayısını gösterir.",
                  ],
                  [
                    "Toplam Varlık",
                    "Sanal nakit bakiye + açık pozisyonların güncel değeri. Alt ipucunda nakit tutarı ve pozisyon adedi görünür.",
                  ],
                  [
                    "Toplam K/Z",
                    "Gerçekleşen + açık pozisyon kâr/zararı; yeşil (pozitif), kırmızı (negatif) veya nötr renk kodludur.",
                  ],
                  [
                    "En Çok Yükselenler / En Çok Düşenler",
                    "İzleme listenizdeki hisseler günlük değişim yüzdesine göre sıralanır; en çok yükselen ve düşen 5'er sembol listelenir. Veri yoksa \u201cŞimdi Yenile\u201d ile tick tetiklemeniz önerilir.",
                  ],
                  [
                    "Satıra tıklama (yükselenler/düşenler)",
                    "Doğrudan o hissenin detay sayfasına (/stock/sembol) götürür.",
                  ],
                  [
                    "Tümünü Gör",
                    "İzleme Listesi sayfasına geçer.",
                  ],
                  [
                    "Trading Sayfasına Git / Yönetim Paneline Git",
                    "Sayfanın altındaki mavi kutudan ilgili bölümlere kısayol.",
                  ],
                ]}
              />
            </SubSection>

            {/* ---- 2.2 İzleme Listesi ---- */}
            <SubSection id="ekran-watchlist" title="İzleme Listesi" route="/watchlist">
              <p className="text-sm leading-relaxed text-gray-300">
                Takip ettiğiniz hisselerin canlı fiyat tablosudur. Sayfa başında
                \u201cCanlı Takip\u201d rozeti görünür; fiyatlar 10 saniyede bir
                otomatik yenilenir.
              </p>

              <Screenshot
                src="/screenshots/watchlist.png"
                alt="BorsaRobot İzleme Listesi — fiyat tablosu, sembol ekleme formu ve Şimdi Yenile butonu"
                caption="İzleme Listesi (/watchlist): sembol ekleme formu, \u201cŞimdi Yenile\u201d butonu ve fiyat tablosu (Sembol, Ad, Son Fiyat, Günlük Değişim, Eğilim, İşlem)."
              />

              <InfoTable
                headers={["Kart / Buton", "Ne Yapar"]}
                rows={[
                  [
                    "Sembol giriş alanı + Ekle",
                    "3–5 harfli BIST sembolü yazıp (örn. THYAO) listeye ekler. Sembol veri tabanında kayıtlı olmalıdır; geçersiz sembolde buton pasiftir. Başarılı eklemede yeşil bildirim gösterilir.",
                  ],
                  [
                    "Şimdi Yenile",
                    "Yeni bir piyasa tick'i üretir (fiyatlar değişir) ve tabloyu tazeler. Fiyatlar yalnızca tick ile değiştiğinden yeni fiyat görmek için bu butonu kullanın. Tıklama sırasında \u201cYenileniyor...\u201d yazar.",
                  ],
                  [
                    "Otomatik yenileme (10 sn)",
                    "Her 10 saniyede bir fiyatlar arka planda yeniden çekilir; sayfayı elle yenilemeniz gerekmez.",
                  ],
                  [
                    "Fiyat tablosu",
                    "Sütunlar: Sembol, Ad, Son Fiyat, Günlük Değişim (TL ve %), Eğilim (1G) ve İşlem. Boşken \u201cİzleme listesi boş\u201d uyarısı gösterir.",
                  ],
                  [
                    "Eğilim (sparkline)",
                    "Her satırda son fiyat örneklemesinden üretilen küçük SVG trend çizgisi; yeşil yükseliş, kırmızı düşüş gösterir.",
                  ],
                  [
                    "Çöp kutusu simgesi (İşlem sütunu)",
                    "Sembolü listeden kaldırır — hisse kaydı silinmez, yalnızca takipten düşer. Başarılı çıkarmada yeşil bildirim gösterilir.",
                  ],
                  [
                    "Satıra tıklama",
                    "O hissenin detay sayfasını (/stock/sembol) açar.",
                  ],
                ]}
              />
            </SubSection>

            {/* ---- 2.3 Hisse Detayı ---- */}
            <SubSection id="ekran-stock" title="Hisse Detayı" route="/stock/[symbol]">
              <p className="text-sm leading-relaxed text-gray-300">
                Tek hissenin derinlemesine analiz sayfasıdır: canlı mum grafiği,
                dönem istatistikleri, AI analizi, haberler ve hızlı emir
                kısayolları bir aradadır.
              </p>

              <Screenshot
                src="/screenshots/stock-detail.png"
                alt="BorsaRobot Hisse Detayı — mum grafik, dönem seçici, istatistikler ve hızlı AL/SAT butonları"
                caption="Hisse Detayı (/stock/THYAO): fiyat başlığı, dönem seçici (1G/1H/1A/3A/1Y), mum grafik, Dönem İstatistikleri ve Hızlı İşlem butonları."
              />

              <InfoTable
                headers={["Kart / Buton", "Ne Yapar"]}
                rows={[
                  [
                    "Fiyat başlığı (Son Fiyat)",
                    "Büyük puntoyla son fiyatı ve günlük değişimi (TL + %) gösterir. Grafikte bir mumun üzerine gelince \u201cSeçili Mum\u201d etiketiyle o mumun kapanışı görünür. Sağda Günlük Aralık ve Son Güncelleme saati vardır.",
                  ],
                  [
                    "Dönem seçici (1G / 1H / 1A / 3A / 1Y)",
                    "Grafik dönemini değiştirir; seçilen dönem için fiyat geçmişi yeniden çekilir. Aktif dönem mavi vurguludur.",
                  ],
                  [
                    "Mum grafik + crosshair",
                    "TradingView Lightweight Charts ile candlestick grafik. İmleci gezdirdiğinizde o mumun Açılış/Yüksek/Düşük/Kapanış (A/Y/D/K) değerleri grafik üstündeki tooltip satırında görünür. Grafik her 10 saniyede bir son mumu günceller.",
                  ],
                  [
                    "Yenile (grafik kartı)",
                    "Seçili dönem için fiyat geçmişini yeniden çeker.",
                  ],
                  [
                    "Dönem İstatistikleri",
                    "Seçili dönem için En Yüksek, En Düşük, Ortalama ve Örneklem (veri noktası sayısı) metrikleri.",
                  ],
                  [
                    "Hızlı İşlem — AL / SAT",
                    "Sizi /trading sayfasındaki emir formuna götürür; sembol ve yön (al/sat) hazır gelir. Alt notta hissenin izleme listesinde olup olmadığı yazar.",
                  ],
                ]}
              />

              <HelpCard title="AI Analizi bölümü">
                <InfoTable
                  headers={["Öğe", "Ne Yapar"]}
                  rows={[
                    [
                      "Analiz Et",
                      "LLM'den o anki karar istenir. İşlem sırasında \u201cAnaliz Ediliyor…\u201d yazar; ilk analiz 30 saniyeye kadar sürebilir.",
                    ],
                    [
                      "Karar rozeti",
                      "BUY (AL, yeşil) / SELL (SAT, kırmızı) / HOLD (BEKLE, gri) olarak gösterilir.",
                    ],
                    [
                      "Güven Skoru",
                      "0.0–1.0 arası modelin kendinden eminlik derecesi; yüzde olarak ve renkli bar ile gösterilir.",
                    ],
                    [
                      "Gerekçe",
                      "En fazla 3 cümlelik Türkçe açıklama.",
                    ],
                    [
                      "Öne Çıkan Riskler",
                      "En fazla 5 maddelik risk listesi (varsa).",
                    ],
                    [
                      "Analiz Geçmişi",
                      "Son 5 analiz kaydı (karar, tarih, güven, sağlayıcı) listelenir; her analiz veri tabanına kaydedilir.",
                    ],
                    [
                      "Hata mesajı",
                      "API anahtarı yoksa veya cooldown aktifse sarı uyarı kutusunda yönlendirici mesaj gösterilir.",
                    ],
                  ]}
                />
              </HelpCard>

              <HelpCard title="Haberler bölümü">
                <InfoTable
                  headers={["Öğe", "Ne Yapar"]}
                  rows={[
                    [
                      "Haber Tara",
                      "Google News'ten bu hisse için yeni tarama yapar. Sonuç özeti gösterilir: \u201cTarama tamamlandı: X makale bulundu — Y yeni, Z zaten kayıtlı.\u201d",
                    ],
                    [
                      "Makale listesi",
                      "O hisseyle eşleşen son haberler; başlık, kaynak, özet ve tarih. Başlığa tıklayınca haber yeni sekmede açılır.",
                    ],
                    [
                      "Daha Fazla (n/total)",
                      "Sonraki sayfadaki makaleleri listenin sonuna ekler.",
                    ],
                  ]}
                />
              </HelpCard>
            </SubSection>

            {/* ---- 2.4 Ticaret Paneli ---- */}
            <SubSection id="ekran-trading" title="Ticaret Paneli" route="/trading">
              <p className="text-sm leading-relaxed text-gray-300">
                Emir verme, portföy ve geçmiş görünümünün birleşik panosudur.
                Başlıkta aktif mod rozeti (\u201cSanal (Paper) Mod\u201d veya
                \u201cCanlı Mod\u201d) görünür.
              </p>

              <Screenshot
                src="/screenshots/trading.png"
                alt="BorsaRobot Ticaret Paneli — hesap özeti, pozisyonlar, hızlı emir formu ve emir geçmişi"
                caption="Ticaret Paneli (/trading): Otomatik motor durum kartı, Hesap Özeti, Pozisyonlar tablosu, Hızlı Emir formu ve Emir Geçmişi."
              />

              <InfoTable
                headers={["Kart / Buton", "Ne Yapar"]}
                rows={[
                  [
                    "Otomatik Alım-Satım Motoru (durum kartı)",
                    "Motorun Etkin/Devre Dışı olduğunu, döngü aralığını, zamanlayıcı durumunu ve son döngünün sonucunu (kaç pozisyon tarandı, SL/TP tetikleri, kaç emir verildi, atlanma nedeni) gösterir. Burası yalnızca izleme amaçlıdır; motoru açıp kapatmak admin panelinden yapılır.",
                  ],
                  [
                    "Hesap Özeti",
                    "Nakit Bakiye, Pozisyon Değeri, Toplam Varlık ve Toplam K/Z kartları; Toplam K/Z ipucunda gerçekleşen/açık ayrımı gösterilir.",
                  ],
                  [
                    "Pozisyonlar tablosu",
                    "Açık pozisyonlar — Sembol, Adet, Ort. Maliyet, Güncel Fiyat, Piyasa Değeri, K/Z (TL) ve K/Z %. Boşken \u201cAçık pozisyon yok\u201d gösterir.",
                  ],
                ]}
              />

              <HelpCard title="Hızlı Emir formu">
                <InfoTable
                  headers={["Öğe", "Ne Yapar"]}
                  rows={[
                    [
                      "Sembol",
                      "İzleme listenizden açılır listeden seçilir; her seçenek sembol, ad ve güncel fiyatı gösterir.",
                    ],
                    [
                      "Yön: AL / SAT",
                      "Emir yönünü belirler; AL yeşil, SAT kırmızı vurgulanır.",
                    ],
                    [
                      "Miktar (lot)",
                      "Tamsayı lot adedi. Geçersiz girişte \u201cMiktar 1 veya daha büyük bir tamsayı olmalıdır.\u201d uyarısı çıkar.",
                    ],
                    [
                      "Tahmini tutar kutusu",
                      "Seçim yaptıkça canlı hesaplanır — fiyat × adet + komisyon. AL için \u201cToplam maliyet\u201d, SAT için \u201cNet hasılat\u201d gösterilir. PAPER modda komisyon uygulanır; LIVE döviz işlemlerinde komisyon yoktur.",
                    ],
                    [
                      "Gönder butonu (AL — SEMBOL / SAT — SEMBOL)",
                      "Emri gönderir. Sonuç: emir anında eşleşir (FILLED) veya reddedilir (REJECTED — örn. yetersiz bakiye) ve yeşil/kırmızı sonuç mesajı gösterilir. Her gönderimde benzersiz bir clientRequestId üretilir; aynı istek iki kez düşerse ikincisi yeni emir açmaz (idempotency koruması).",
                    ],
                    [
                      "CANLI İŞLEM uyarı kutusu (yalnızca LIVE)",
                      "Kırmızı \u201cCANLI İŞLEM MODU AKTİF\u201d kutusu görünür; \u201cGerçek para ile işlem yapılacağını... onaylıyorum\u201d kutucuğu işaretlenmeden gönder düğmesi etkinleşmez. Onay her emirden sonra sıfırlanır — her canlı emir için bilinçli, ayrı onay gerekir.",
                    ],
                  ]}
                />
              </HelpCard>

              <HelpCard title="Emir Geçmişi">
                <InfoTable
                  headers={["Öğe", "Ne Yapar"]}
                  rows={[
                    [
                      "Emir tablosu",
                      "Tüm emirler — Zaman, Sembol, Yön (AL/SAT), Adet, Fiyat, Tutar, Komisyon, K/Z, Durum ve Kaynak.",
                    ],
                    [
                      "Durum rozetleri",
                      "Gerçekleşti (FILLED, yeşil), Reddedildi (REJECTED, kırmızı), Bekliyor/İşleniyor/Mutabakat (amber), İptal (gri). Hata mesajı varsa rozet üzerine gelince görünür.",
                    ],
                    [
                      "Kaynak rozetleri",
                      "Manuel (gri, kullanıcı ikonu) = sizin emriniz; Otomatik (mor, robot ikonu) = otomatik motor; Kural (amber) = SL/TP kural tetiklemesi.",
                    ],
                    [
                      "Önceki / Sonraki",
                      "Sayfalama kontrolleri; \u201cToplam X emir · Sayfa Y/Z\u201d bilgisi gösterilir.",
                    ],
                  ]}
                />
              </HelpCard>
            </SubSection>

            {/* ---- 2.5 Yönetim Paneli ---- */}
            <SubSection id="ekran-admin" title="Yönetim Paneli" route="/admin">
              <p className="text-sm leading-relaxed text-gray-300">
                Tüm sistem yapılandırmasının yapıldığı bölümdür. Üç sekmeden
                oluşur: <strong>AI Ayarları</strong>, <strong>Promptlar</strong>{" "}
                ve <strong>Risk & Mod</strong>. Her bölüm kendi
                \u201cKaydet\u201d düğmesine sahiptir; kaydedilen değerler anında
                etkinleşir (sunucu yeniden başlatma gerekmez).
              </p>

              <Screenshot
                src="/screenshots/admin-ai.png"
                alt="BorsaRobot Yönetim Paneli — AI Ayarları sekmesi: sağlayıcı seçimi, model, bağlantı testi ve API anahtarları"
                caption="Yönetim Paneli (/admin) — AI Ayarları sekmesi: Aktif Sağlayıcı, Model, Bağlantı Testi ve API anahtarı kartları."
              />

              <HelpCard title="AI Ayarları sekmesi">
                <InfoTable
                  headers={["Alan / Buton", "Ne Yapar"]}
                  rows={[
                    [
                      "Aktif Sağlayıcı (Google Gemini / OpenAI)",
                      "Tüm analiz isteklerinin gideceği sağlayıcıyı seçer; seçim anında kaydedilir ve \u201cAktif\u201d rozeti taşınır.",
                    ],
                    [
                      "Model",
                      "Sağlayıcıya göre açılır liste: Gemini için gemini-2.0-flash (hızlı/ekonomik), gemini-2.0-flash-lite (en ekonomik), gemini-1.5-flash, gemini-1.5-pro (en yetenekli); OpenAI için gpt-4o (dengeli, önerilen), gpt-4o-mini (ekonomik), gpt-4.1, gpt-4.1-mini.",
                    ],
                    [
                      "Bağlantı Testi — Test Et",
                      "Aktif sağlayıcı + model + anahtar kombinasyonuyla kısa bir ping promptu gönderir; anahtarın geçerliliğini kaydetmeden doğrular. Sonuç yeşil/kırmızı kutuda gösterilir.",
                    ],
                    [
                      "Google Gemini API Key / OpenAI API Key",
                      "Maskeli anahtar girişi (göz ikonu göster/gizler). \u201cKayıtlı: ••••1234\u201d biçiminde mevcut anahtarın son 4 hanesi gösterilir. Kaydet anahtarı veri tabanına yazar (koda gömülmez); Temizle anahtarı siler.",
                    ],
                  ]}
                />
              </HelpCard>

              <Screenshot
                src="/screenshots/admin-prompts.png"
                alt="BorsaRobot Yönetim Paneli — Promptlar sekmesi: Hisse Analiz ve Haber Tarama promptları"
                caption="Yönetim Paneli — Promptlar sekmesi: Hisse Analiz Promptu ve Haber Tarama Promptu editörleri."
              />

              <HelpCard title="Promptlar sekmesi">
                <InfoTable
                  headers={["Alan / Buton", "Ne Yapar"]}
                  rows={[
                    [
                      "Hisse Analiz Promptu",
                      "Hisse analiz kararlarını üreten ana talimat. Her analiz döngüsünde hisse + haber + fiyat verisiyle birleştirilir. Yanıtın {\"action\": \"BUY|SELL|HOLD\", \"confidence\": 0.0-1.0, ...} JSON yapısını isteyen kural metni korunmalıdır.",
                    ],
                    [
                      "Haber Tarama Promptu",
                      "Günlük haber akışını hisselerle eşleştiren ve duygu sınıflandıran talimat. {\"articles\": [...]} JSON yapısı kuralı korunmalıdır.",
                    ],
                    [
                      "Varsayılana Dön",
                      "İlgili prompt metnini fabrika varsayılanına geri getirir (karakter sayısı yanında gösterilir).",
                    ],
                    [
                      "Promptları Kaydet",
                      "Değişen promptları kaydeder; kaydedilen metinler sonraki tüm analizlerde kullanılır.",
                    ],
                  ]}
                />
              </HelpCard>

              <Screenshot
                src="/screenshots/admin-risk.png"
                alt="BorsaRobot Yönetim Paneli — Risk & Mod sekmesi: Çalışma Modu, Otomatik Ticaret ve Risk Yönetimi kartları"
                caption="Yönetim Paneli — Risk & Mod sekmesi: Çalışma Modu (PAPER/LIVE), Otomatik Ticaret (motor anahtarı, döngü aralığı, Şimdi Çalıştır, Son Döngüler) ve Risk Yönetimi."
              />

              <HelpCard title="Risk & Mod sekmesi — Çalışma Modu kartı">
                <InfoTable
                  headers={["Alan / Buton", "Ne Yapar"]}
                  rows={[
                    [
                      "Sanal (Paper Trading)",
                      "Emirler sanal bakiye ile simüle edilir; komisyon uygulanır; gerçek para hareketi olmaz. Güvenli deneme modu.",
                    ],
                    [
                      "Canlı (Live Trading)",
                      "Emirler DenizBank ChangeExchange ile gerçek para hareketi üretir. LIVE'a geçerken risk parametrelerini gösteren zorunlu onay diyaloğu açılır; onay damgası olmadan hiçbir canlı emir sunucuda kabul edilmez.",
                    ],
                    [
                      "Onay diyaloğu (\u201cOnaylıyorum, Canlı moda Geç\u201d)",
                      "Stop-Loss, Take-Profit, güven eşiği, pozisyon tutarı, açık pozisyon ve günlük bütçe değerlerini listeler; onayla geçiş yapar, \u201cVazgeç\u201d iptal eder.",
                    ],
                    [
                      "DenizBank Bağlantısını Test Et",
                      "Bankaya GetAccountList isteği atar; AppKey ve temel adresin doğruluğunu, hesap listesinin dönüp dönmediğini gösterir. Mock modda çalışıyorsa yanıtta mockMode belirtilir.",
                    ],
                    [
                      "Canlı mod uyarı bandı",
                      "LIVE seçiliyken kırmızı bantta \u201cCanlı mod aktif. Onay damgası: [tarih]\u201d gösterilir.",
                    ],
                  ]}
                />
              </HelpCard>

              <HelpCard title="Risk & Mod sekmesi — Otomatik Ticaret kartı">
                <InfoTable
                  headers={["Alan / Buton", "Ne Yapar"]}
                  rows={[
                    [
                      "Motor Anahtarı (aç/kapa)",
                      "Motoru açar/kapatır. Açıkken scheduler her döngüde izleme listesindeki hisseleri tarar; kapalıyken döngüler atlanır (no-op).",
                    ],
                    [
                      "Döngü Aralığı (saniye)",
                      "İki otomatik döngü arasındaki süre; 10–3600 sn aralığında, varsayılan 60 sn.",
                    ],
                    [
                      "Otomatik Ticaret Ayarlarını Kaydet",
                      "Anahtar + aralık ayarlarını kaydeder (değişiklik yoksa pasif).",
                    ],
                    [
                      "Şimdi Çalıştır",
                      "Otomatik döngüyü anında tetikler; sonuç \u201cDöngü Sonucu\u201d modalında gösterilir — durum, istatistik ızgarası (taranan pozisyon, SL/TP tetik, AI analiz, cooldown/key yok atlama, emirler) ve Sinyal → Eylem Günlüğü. Escape ile kapanır.",
                    ],
                    [
                      "Son Döngüler + Yenile",
                      "Son 5 otomatik döngü kaydı (Başarılı/Başarısız/Çalışıyor rozetli, süre ve özetli) listelenir.",
                    ],
                    [
                      "Canlı mod uyarısı",
                      "LIVE modda \u201cCanlı modda otomatik alım-satım devre dışıdır\u201d amber uyarısı gösterilir; motor yalnızca Sanal (Paper) modda çalışır.",
                    ],
                  ]}
                />
              </HelpCard>

              <HelpCard title="Risk & Mod sekmesi — Risk Yönetimi kartı">
                <InfoTable
                  headers={["Alan", "Ne Yapar", "Sınır / Varsayılan"]}
                  rows={[
                    [
                      "Stop-Loss (%)",
                      "Açık pozisyon, ortama maliyetin bu yüzdesi kadar zarara inerse otomatik satılır.",
                      "0.5–50 · %5",
                    ],
                    [
                      "Take-Profit (%)",
                      "Pozisyon, maliyetin bu yüzdesi kadar kâra ulaşırsa otomatik satılır (kâr realizasyonu).",
                      "0.5–100 · %10",
                    ],
                    [
                      "Minimum Güven Skoru",
                      "AI kararı BUY/SELL olsa bile güven skoru bu eşiğin altındaysa otomatik emir verilmez.",
                      "0–1 · 0.7",
                    ],
                    [
                      "Maks. Pozisyon Tutarı (TL)",
                      "Tek bir hissedeki pozisyonun tavan değeri; aşan alım emirleri reddedilir.",
                      "1.000–10.000.000 · 50.000 TL",
                    ],
                    [
                      "Maks. Açık Pozisyon",
                      "Aynı anda taşınabilecek farklı hisse sayısı üst sınırı.",
                      "1–50 · 5",
                    ],
                    [
                      "Günlük Emir Bütçesi (TL)",
                      "Bir günde verilebilecek toplam emir tutarı; aşımında günün kalanı için emir durdurulur.",
                      "1.000–10.000.000 · 100.000 TL",
                    ],
                    [
                      "Analiz Cooldown (dakika)",
                      "Aynı hisse için iki otomatik işlem/analiz arasındaki zorunlu bekleme süresi (fazla alım-satımı önler).",
                      "0–1440 · 60 dk",
                    ],
                    [
                      "Risk Ayarlarını Kaydet",
                      "Tüm risk parametrelerini kaydeder; geçersiz değerler istemci ve sunucu tarafında reddedilir.",
                      "—",
                    ],
                  ]}
                />
              </HelpCard>
            </SubSection>
          </HelpSection>

          {/* ============ 3. OTOMATİK MOTOR NASIL ÇALIŞIR ============ */}
          <HelpSection
            id="otomatik-motor"
            title="Otomatik Motor Nasıl Çalışır"
            description="Motor, sunucu başladığında devreye giren zamanlayıcı ile periyodik döngü çalıştırır. Her döngüde sırasıyla şu adımlar işlenir:"
          >
            <StepList
              items={[
                <>
                  <strong>Zamanlayıcı:</strong> Uygulama ayağa kalkarken
                  başlar; döngü aralığı admin panelindeki ayardan okunur
                  (varsayılan 60 sn). <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-blue-300">AUTO_TRADE_SCHEDULER_DISABLED=1</code>{" "}
                  ortam değişkeniyle tamamen kapatılabilir.
                </>,
                <>
                  <strong>Mod kontrolü:</strong> Çalışma modu PAPER değilse
                  döngü güvenlik gereği atlanır — canlı modda otomatik emir{" "}
                  <strong>asla</strong> verilmez.
                </>,
                <>
                  <strong>Motor anahtarı kontrolü:</strong> Otomatik ticaret
                  anahtarı kapalıysa döngü no-op olarak atlanır.
                </>,
                <>
                  <strong>Stop-Loss / Take-Profit taraması:</strong> Tüm açık
                  pozisyonlar kontrol edilir; SL/TP eşiği aşanlar otomatik
                  satılır.
                </>,
                <>
                  <strong>AI analizi:</strong> İzleme listesindeki hisseler için
                  (cooldown'a tabi olanlar hariç) LLM'den karar
                  istenir; API anahtarı yoksa bu adım atlanır ve döngü özetinde
                  \u201cKey yok atlama\u201d sayılır.
                </>,
                <>
                  <strong>Emir üretimi:</strong> BUY kararı, güven skoru eşiği
                  geçiyorsa ve risk kuralları (pozisyon tavanı, açık pozisyon
                  sayısı, günlük bütçe) elveriyorsa alım emri açılır.
                </>,
                <>
                  <strong>Denetim:</strong> Her döngü JobRun kaydına yazılır
                  (durum, süre, özet); /trading sayfasındaki durum kartı ve
                  admin panelindeki \u201cSon Döngüler\u201d listesi bu
                  kayıtlardan beslenir.
                </>,
              ]}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <HelpCard title="İzolasyon ve idempotency">
                <p className="text-sm leading-relaxed text-gray-400">
                  Her döngü benzersiz bir <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-blue-300">cycleId</code> ile
                  çalışır; aynı cycleId tekrar işlenirse yeni emir açılmaz.
                  Manuel pozisyonlarınıza dokunulmadan yalnızca kural
                  tetiklemeleri işlem görür.
                </p>
              </HelpCard>
              <HelpCard title="Hata dayanıklılığı">
                <p className="text-sm leading-relaxed text-gray-400">
                  Haber çekme hatası, LLM hatası veya veri tabanı hatası tek
                  döngüyü düşürür; motor bir sonraki döngüde çalışmaya devam
                  eder. Hatalar döngü özetinde sayılır.
                </p>
              </HelpCard>
              <HelpCard title="Önerilen ilk kullanım">
                <p className="text-sm leading-relaxed text-gray-400">
                  Motoru önce kapalı tutun → izleme listenize 2–3 hisse ekleyin
                  → hisse detayından manuel \u201cAnaliz Et\u201d ile AI
                  kararlarının kalitesini gözlemleyin → risk parametrelerini
                  bakiyenize göre ayarlayın → motoru açıp /trading durum
                  kartından döngüleri izleyin.
                </p>
              </HelpCard>
            </div>

            <Callout tone="warning" title="Neden emir vermeyebilir?">
              Motor emir vermediğinde sırayla şu nedenler kontrol edilmelidir:
              (1) motor anahtarı kapalı, (2) çalışma modu PAPER değil, (3) AI
              güven skoru eşiğin altında, (4) cooldown süresi dolmamış, (5)
              günlük bütçe veya pozisyon limitleri dolmuş, (6) API anahtarı
              tanımlanmamış. Döngü özetinde atlanma nedeni açıkça yazılır.
            </Callout>
          </HelpSection>

          {/* ============ 4. SIK KARŞILAŞILAN SORUNLAR ============ */}
          <HelpSection
            id="sorunlar"
            title="Sık Karşılaşılan Sorunlar"
            description="En yaygın hata durumları ve çözümleri:"
          >
            <div className="space-y-4">
              <HelpCard title="AI analizi \u201canahtar bulunamadı\u201d hatası veriyor">
                <p className="text-sm leading-relaxed text-gray-400">
                  /admin → AI Ayarları sekmesinden sağlayıcı seçip geçerli bir
                  API anahtarı girin ve Kaydet'e basın. \u201cTest
                  Et\u201d ile doğrulayın. Anahtar girilmeden de fiyat takibi,
                  izleme listesi ve sanal emirler çalışır; ancak AI analizi ve
                  otomatik motor anahtar gerektirir.
                </p>
              </HelpCard>

              <HelpCard title="Fiyatlar neden değişmiyor?">
                <p className="text-sm leading-relaxed text-gray-400">
                  Fiyatlar yalnızca piyasa tick'i ile değişir. İzleme
                  listesindeki \u201cŞimdi Yenile\u201d düğmesine basın — bu,
                  yeni bir tick üretip tabloyu tazeler. Otomatik yenileme
                  (10 sn) yalnızca mevcut fiyatları yeniden çeker, yeni tick
                  üretmez.
                </p>
              </HelpCard>

              <HelpCard title="Otomatik motor emir vermiyor">
                <p className="text-sm leading-relaxed text-gray-400">
                  Sırayla kontrol edin: (1) Motor anahtarı açık mı? (2) Çalışma
                  modu PAPER mi? (3) AI güven skoru eşik altında olabilir —
                  /trading durum kartındaki döngü özetine bakın. (4) Cooldown
                  süresi dolmamış olabilir. (5) Günlük bütçe veya pozisyon
                  limitleri dolmuş olabilir. (6) API anahtarı tanımlı mı?
                </p>
              </HelpCard>

              <HelpCard title="Emrim REJECTED oldu">
                <p className="text-sm leading-relaxed text-gray-400">
                  En yaygın nedenler: yetersiz sanal bakiye, maksimum pozisyon
                  değeri aşımı, maksimum açık pozisyon sayısı aşımı veya günlük
                  emir bütçesinin tükenmesi. Hata mesajı nedeni belirtir;
                  emir geçmişte \u201cReddedildi\u201d rozetiyle görünür.
                </p>
              </HelpCard>

              <HelpCard title="Canlı moda geçemiyorum / canlı emir reddediliyor">
                <p className="text-sm leading-relaxed text-gray-400">
                  <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-blue-300">LIVE_MODE_NOT_CONFIRMED</code>{" "}
                  hatası, mod değiştirme onayının (onay damgası) bulunmadığını
                  gösterir — admin panelinden LIVE'a geçiş diyaloğunu
                  onaylayın.{" "}
                  <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-blue-300">LIVE_STOCK_NOT_SUPPORTED</code>{" "}
                  hatası normaldir: canlı modda yalnızca döviz (USD/TRY)
                  işlemi yapılabilir, hisse emri verilmez.
                </p>
              </HelpCard>

              <HelpCard title="Canlı mod uyarıları">
                <p className="text-sm leading-relaxed text-gray-400">
                  Canlı modda gerçek para hareketi olduğundan emir vermeden
                  önce miktarı ve yönü iki kez kontrol edin. Her canlı emrin
                  TransactionID ve SessionID mutabakat değerleri emir kaydına
                  yazılır; tüm banka çağrıları AppKey maskeli olarak denetim
                  izine düşer. Otomatik motor canlı modda güvenlik gereği
                  devre dışıdır.
                </p>
              </HelpCard>
            </div>

            <Callout tone="success" title="Sağlık kontrolü">
              Her şeyin sağlıklı olduğunu komut satırından doğrulamak için{" "}
              <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-emerald-300">npm run verify:all</code>{" "}
              (7 doğrulama script'i, 101 kontrol — hepsi mock modda,
              güvenli) ve{" "}
              <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-emerald-300">npm run typecheck</code>{" "}
              komutlarını kullanabilirsiniz.
            </Callout>

            <p className="text-sm text-gray-500">
              Daha ayrıntılı teknik mimari için{" "}
              <Link
                href="/"
                className="text-blue-400 transition-colors hover:text-blue-300"
              >
                ana panele
              </Link>{" "}
              dönebilir veya proje kökündeki KULLANIM.md ve
              docs/ARCHITECTURE.md belgelerine bakabilirsiniz.
            </p>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
