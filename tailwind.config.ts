import type { Config } from "tailwindcss";

/**
 * Tailwind CSS 4 yapılandırması.
 *
 * Tailwind v4 varsayılan olarak kaynak dosyaları otomatik tarar; bu dosya
 * `src/app/globals.css` içindeki `@config` direktifi ile yüklenerek ileriye
 * dönük tema genişletmeleri (marka renkleri, font ailesi) için tek nokta
 * sağlar.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
};

export default config;
