import path from "node:path";
import type { NextConfig } from "next";
import type { WebpackConfigContext } from "next/dist/server/config-shared";

const nextConfig: NextConfig = {
  // Üretim deployment'ı için taşınabilir build: `next build` sonrası
  // `.next/standalone` klasörü bağımsız bir server.js ile çalışır
  // (VPS/PM2 ve cPanel Passenger senaryoları — bkz. DEPLOYMENT.md).
  output: "standalone",
  // Prisma istemcisi server-side çalışır; bundle'a gömülmesini engellemek gerekmez,
  // ancak route'ların Node.js runtime'ında kalması için varsayılan davranış korunur.
  serverExternalPackages: ["@prisma/client"],
  webpack(config, options: WebpackConfigContext) {
    // Next.js instrumentation.ts'yi hem Node hem Edge runtime için derler.
    // Edge bundle'ında Node built-in `crypto` çözülemez; Edge'de bu modülün
    // kodu asla koşmaz (instrumentation `NEXT_RUNTIME === "nodejs"` guard'lı) —
    // derlemenin geçmesi için edge derlemesinde tip-uyumlu stub'a yönlendirilir.
    //
    // Not: `resolve.alias` burada işe yaramaz — Next.js'in JsConfigPathsPlugin'i
    // `@/*` isteklerini alias aşamasından ÖNCE (described-resolve hook'unda)
    // gerçek dosyaya rewrite eder. NormalModuleReplacementPlugin ise resolve'dan
    // önce (beforeResolve) çalışır ve isteği güvenilir biçimde yakalar.
    if (config.name === "edge-server") {
      const { webpack } = options;
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]secret-crypto$/,
          path.resolve(process.cwd(), "src/lib/secret-crypto.edge-stub.ts"),
        ),
      );
    }
    return config;
  },
};

export default nextConfig;
