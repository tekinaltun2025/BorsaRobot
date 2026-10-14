import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Birim testleri tests/ dizininde; node ortamı (server-side modüller).
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Her test dosyası izole çalışır; rate-limit gibi modül-durumu
    // tutan dosyalar için dosya başına ayrı worker garantisi yeterlidir.
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
