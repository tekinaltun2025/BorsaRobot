import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "prisma/migrations/**",
    "public/screenshots/**",
    // Puppeteer tabanlı ekran görüntüsü scriptleri — CommonJS require kullanır,
    // üretim koduna dahil değildir.
    "scripts/take-*.js",
  ]),
  {
    rules: {
      // Proje sözleşmesi: console.error bilinçli olarak hata katmanında
      // kullanılıyor (route handler'larında son savunma logu).
      "no-console": "off",
      // React Compiler'ın deneysel katı kuralları — mevcut polling effect
      // desenleriyle (setInterval + setState) çakışır. Davranış değişikliği
      // riski almadan önce uyarı seviyesinde izlenir.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // Türkçe metinlerde tırnak işaretleri bilinçli kullanılıyor; JSX kaçışı
      // okunabilirliği düşürür. Uyarı seviyesinde tutulur.
      "react/no-unescaped-entities": "warn",
    },
  },
]);
