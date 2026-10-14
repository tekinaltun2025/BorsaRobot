import { prisma } from "@/lib/prisma";
import { scanNewsForStock } from "@/server/services/news-service";

async function run() {
  try {
    const symbol = "AEFES";
    console.log(`Starting news scan for ${symbol}...`);
    const result = await scanNewsForStock(symbol);
    console.log("Scan Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error during scan:", error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
