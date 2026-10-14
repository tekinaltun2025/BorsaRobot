# BorsaRobot — Üretim Deployment Rehberi (7/24 Çalıştırma)

Bu rehber projeyi bir sunucuda **7/24 kesintisiz** çalıştırmak için gereken tüm
adımları içerir ve "cPanel'de çalıştırabilir miyim?" sorusunu net cevaplar.

## İçindekiler

1. [cPanel'de Çalışır mı?](#1-cpanelde-çalışır-mı)
2. [Gereksinimler](#2-gereksinimler)
3. [Yol A — VPS + PM2 (Önerilen)](#3-yol-a--vps--pm2-önerilen)
4. [Yol B — cPanel VPS + "Setup Node.js App" (Passenger)](#4-yol-b--cpanel-vps--setup-nodejs-app-passenger)
5. [7/24 Scheduler Notları](#5-724-scheduler-notları)
6. [SQLite Kalıcılık ve Yedekleme](#6-sqlite-kalıcılık-ve-yedekleme)
7. [Üretim Ortam Değişkenleri](#7-üretim-ortam-değişkenleri)
8. [Sorun Giderme](#8-sorun-giderme)

---

## 1. cPanel'de Çalışır mı?

**Kısa cevap:** cPanel'in türüne bağlı — **paylaşımlı (shared) cPanel'de önerilmez,
root erişimli cPanel VPS'de rahatça çalışır.**

| Ortam | Sonuç | Açıklama |
|---|---|---|
| Paylaşımlı cPanel (shared hosting) | ⚠️ Önerilmez | Süreç kısıtları + eski Node + build limitleri |
| cPanel VPS (WHM/root erişimli) | ✅ Çalışır | SSH açıp Yol A (PM2) uygulanır; Passenger da mümkün (Yol B) |
| Düz Linux VPS | ✅ En iyisi | En az uğraşla 7/24; önerilen yol |

### Paylaşımlı cPanel neden önerilmez?

1. **Süreç modeli çakışması** — Otomatik alım-satım ve BIST 100 senkron
   zamanlayıcıları ([`src/instrumentation.ts`](src/instrumentation.ts)) uygulama
   sürecinin 7/24 ayakta kalmasını gerektirir. Shared hosting firmaları boşta
   bekleyen Node.js süreçlerini kapatma hakkını saklı tutar; süreç ölünce
   scheduler da durur ve otomatik işlemler kesilir.
2. **Node.js sürümü** — Next.js 15.5 için **Node ≥ 18.18.18** gerekir; shared
   paketlerde genelde eski sürüm bulunur.
3. **Build kaynakları** — `next build`, shared paketlerin CPU/RAM limitine takılır;
   build'i kendi bilgisayarınızda yapıp çıktıyı yüklemeniz gerekir.
4. **Yedekleme kontrolü** — SQLite dosyası ve yedekleme tam sizin kontrolünüzde
   değildir.

> **Öneri:** Aylık ~4–6 € bir VPS (Hetzner CX22, Contabo, DigitalOcean vb.) tüm
> bu sorunları ortadan kaldırır. Aşağıdaki Yol A yaklaşık 15 dakikada kurulur.

---

## 2. Gereksinimler

| Bileşen | Minimum | Not |
|---|---|---|
| Node.js | 18.18.18 (öneri: **20 LTS**) | `node -v` ile kontrol |
| RAM | 2 GB | Build için 2 GB önerilir; çalışma ~300–500 MB |
| CPU | 2 vCPU | |
| Disk | 10 GB | SQLite + log büyümesi için pay bırakın |
| OS | Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9 | cPanel VPS için AlmaLinux yaygın |

---

## 3. Yol A — VPS + PM2 (Önerilen)

### 3.1 Node.js 20 kurulumu (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v20.x.x görmelisiniz
```

### 3.2 Projeyi hazırlama

```bash
git clone <repo-adresi> ~/BorsaRobot
cd ~/BorsaRobot
npm ci

# .env dosyasını oluşturun (bkz. bölüm 7 — üretim değerleri ZORUNLU)
cp .env.example .env
nano .env

# Veri tabanı şeması + başlangıç verisi
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

### 3.3 Build + 7/24 başlatma (PM2)

```bash
npm run build
sudo npm install -g pm2

pm2 start ecosystem.config.js
pm2 status           # "online" görmelisiniz
pm2 logs borsarobot  # canlı log takibi
```

[`ecosystem.config.js`](ecosystem.config.js) dosyası projede hazır gelir:
çökme sonrası otomatik yeniden başlatma (`autorestart`), 512 MB bellek sınırı
aşılırsa restart (`max_memory_restart`) ve `NODE_ENV=production` ayarlıdır.

### 3.4 Sunucu reboot'unda otomatik başlama

```bash
pm2 save
pm2 startup   # çıktısındaki komutu sudo ile çalıştırın
```

### 3.5 Nginx reverse proxy (alan adı + ücretsiz SSL)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/borsarobot
```

Dosya içeriği:

```nginx
server {
    listen 80;
    server_name alanadiniz.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/borsarobot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d alanadiniz.com   # ücretsiz SSL (Let's Encrypt)
```

---

## 4. Yol B — cPanel VPS + "Setup Node.js App" (Passenger)

> Ön koşul: cPanel **VPS** (WHM root erişimi) ve Passenger/Node.js modülü kurulu
> (WHM → Software → EasyApache 4 / Module Installer → Passenger).

1. **cPanel → Software → Setup Node.js App → Create Application**
   - Node.js version: **20.x veya 22.x**
   - Application root: `borsarobot`
   - Application URL: alan adınız
   - Application startup file: `server.js`
2. **Build'i KENDİ BİLGİSAYARINIZDA yapın** (sunucu RAM limitine takılmaması için):
   ```bash
   npm ci
   npx prisma generate
   npm run build
   # Standalone çıktısını tamamla:
   cp -r .next/static .next/standalone/.next/static
   cp -r public .next/standalone/public
   ```
3. `.next/standalone` klasörünün **tamamını** cPanel'deki `borsarobot` klasörüne
   yükleyin (File Manager veya FTP). Yüklediğinizde `server.js` klasör kökünde
   durmalıdır.
4. **Ortam değişkenlerini** uygulama ekranındaki "Environment variables"
   bölümüne girin — standalone sunucu `.env` dosyasını otomatik **YÜKLEMEZ**
   (bkz. bölüm 7):
   - `DATABASE_URL` = `file:/home/KULLANICI/borsarobot/data/borsarobot.db`
     (absolute path; `data` klasörünü elle oluşturun)
   - `ADMIN_PASSWORD`, `SETTINGS_ENCRYPTION_KEY`
5. Veri tabanını hazırlayın (SSH veya cPanel Terminal):
   ```bash
   cd ~/borsarobot
   npx prisma migrate deploy
   npx prisma db seed
   ```
6. **Restart** butonuna basın. Passenger, süreci çökme sonrası otomatik ayağa
   kaldırır.

> ⚠️ **Passenger + 7/24 uyarısı:** Bazı Passenger yapılandırmalarında uzun süre
> istek gelmeyen süreçler askıya alınabilir. Scheduler'ın kesintisiz çalıştığını
> doğrulamak için `/api/health` uç noktasını bir izleme servisiyle (UptimeRobot
> vb.) 5 dakikada bir izleyin — istek trafiği süreci canlı tutar ve olası bir
> kesintiye anında müdahale edersiniz.

---

## 5. 7/24 Scheduler Notları

- Otomatik alım-satım ve BIST 100 senkron zamanlayıcıları
  [`src/instrumentation.ts`](src/instrumentation.ts) içinde
  `NEXT_RUNTIME === "nodejs"` koşuluyla başlar — yani **süreç ayakta olduğu
  sürece** çalışırlar.
- Süreç çökerse scheduler da ölür. Bu yüzden Yol A'daki PM2 `autorestart` ya da
  Yol B'deki Passenger restart davranışı kritiktir.
- `AUTO_TRADE_SCHEDULER_DISABLED=1` ortam değişkeni ile scheduler'ları tamamen
  kapatabilirsiniz (yalnızca manuel kullanım istiyorsanız).
- Birden fazla süreç (ör. yanlışlıkla iki PM2 instance) açılırsa DB tabanlı
  `claimTickLock` kilidi aynı tick'in iki kez çalışmasını engeller.
- Saat dilimi `Europe/Istanbul` sabitlenmiştir; sunucunun TZ ayarı fark etmez.

---

## 6. SQLite Kalıcılık ve Yedekleme

- Üretimde `DATABASE_URL`'i **absolute path** ile verin:
  `file:/home/KULLANICI/BorsaRobot/prisma/prod.db`
- Günlük yedek için cron (VPS):
  ```bash
  crontab -e
  # Her gün 04:00'te yedek al:
  0 4 * * * sqlite3 /home/KULLANICI/BorsaRobot/prisma/prod.db ".backup '/home/KULLANICI/yedekler/borsarobot-$(date +\%F).db'"
  ```
- cPanel kullanıcıları: cPanel → Backup → Download, SQLite dosyasını da kapsar.

---

## 7. Üretim Ortam Değişkenleri

| Değişken | Zorunlu? | Açıklama |
|---|---|---|
| `DATABASE_URL` | ✅ | `file:` absolute path (üretim) |
| `ADMIN_PASSWORD` | ✅ | Güçlü parola; boşsa admin paneli KORUMASIZ kalır |
| `SETTINGS_ENCRYPTION_KEY` | ✅ | API anahtarlarının AES-256-GCM anahtarı; kaybedilirse saklanan anahtarlar kurtarılamaz |
| `AUTO_TRADE_INTERVAL_SECONDS` | — | Scheduler tick aralığı (varsayılan 300) |
| `AUTO_TRADE_SCHEDULER_DISABLED` | — | `1` = scheduler'ları kapat |
| `NEXT_PUBLIC_APP_URL` | — | Çerez/URL üretimi için alan adı |

> **Not:** `next start` (Yol A) `.env` dosyasını otomatik yükler; **standalone**
> sunucu (Yol B) YÜKLEMEZ — değişkenleri Passenger arayüzünden ya da process
> env olarak verin.

---

## 8. Sorun Giderme

| Belirti | Çözüm |
|---|---|
| `pm2 status` → errored | `pm2 logs borsarobot` ile hatayı okuyun; çoğunlukla eksik env veya migrate edilmemiş DB |
| Sayfa 502 | Uygulama portu dinlemiyor; `pm2 restart borsarobot` |
| Scheduler çalışmıyor | `/api/health` uç noktasını kontrol edin; `AUTO_TRADE_SCHEDULER_DISABLED=1` set edilmiş mi bakın |
| Prisma engine hatası | `npx prisma generate` çalıştırıp yeniden build edin |
| Build OOM (1 GB VPS) | Swap ekleyin veya lokalde build edip çıktıyı yükleyin |
