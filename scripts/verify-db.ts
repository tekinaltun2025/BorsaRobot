/**
 * DB doğrulama scripti — seed sonrası veri teyidi için geçici araç.
 * Kullanım: npx tsx scripts/verify-db.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [stocks, account, settings, watchlist, orders, analyses] = await Promise.all([
    prisma.stock.count(),
    prisma.account.findFirst({ where: { accountType: "PAPER" } }),
    prisma.adminSettings.findUnique({ where: { id: "singleton" } }),
    prisma.watchlist.count(),
    prisma.order.count(),
    prisma.aiAnalysisLog.count(),
  ]);

  console.log("=== DB DOĞRULAMA ===");
  console.log(`Stocks: ${stocks}`);
  console.log(`Watchlist: ${watchlist}`);
  console.log(`PaperBalance: ${account?.balance?.toString() ?? "yok"}`);
  console.log(`TradingMode: ${settings?.tradingMode ?? "yok"}`);
  console.log(`AiProvider: ${settings?.aiProvider ?? "yok"}`);
  console.log(`GeminiModel: ${settings?.geminiModel ?? "yok"}`);
  console.log(`Orders: ${orders} | Analyses: ${analyses}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Doğrulama hatası:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
