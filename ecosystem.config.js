/**
 * PM2 süreç tanımı — BorsaRobot'u 7/24 kesintisiz çalıştırır.
 *
 * Kullanım (bkz. DEPLOYMENT.md bölüm 3):
 *   npm run build
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # sunucu reboot'unda otomatik başlama
 *
 * Not: `next start` .env dosyasını otomatik yükler; üretim değerlerinin
 * .env içinde hazır bulunduğundan emin olun (ADMIN_PASSWORD,
 * SETTINGS_ENCRYPTION_KEY, DATABASE_URL — bkz. DEPLOYMENT.md bölüm 7).
 */
module.exports = {
  apps: [
    {
      name: "borsarobot",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // 7/24 süreklilik: çökme sonrası otomatik yeniden başlatma.
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      // Bellek sızıntısı koruması: 512 MB üstünde süreç yeniden başlatılır.
      max_memory_restart: "512M",
      // Log satırlarına zaman damgası ekle (pm2 logs borsarobot).
      time: true,
    },
  ],
};
