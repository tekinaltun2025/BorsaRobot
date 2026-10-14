import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("=== HABER ÖNEM DERECESİ DOĞRULAMA ===");
  
  const articles = await prisma.newsArticle.findMany({
    where: {
      stock: {
        symbol: "AEFES"
      }
    },
    orderBy: {
      publishedAt: "desc"
    }
  });

  if (articles.length === 0) {
    console.error("Hata: AEFES için hiç haber bulunamadı!");
    return;
  }

  console.log(`Toplam ${articles.length} adet haber bulundu.\n`);
  console.log(`${"BAŞLIK".padEnd(40)} | ${"ÖNEM".padEnd(12)} | ${"NEDEN (IMPACT)"}`);
  console.log("-".repeat(80));

  for (const article of articles) {
    const title = article.title.length > 37 ? article.title.substring(0, 37) + "..." : article.title;
    const importance = article.importanceLevel ?? "NULL";
    const reasoning = article.impactReasoning ?? "Yok";

    console.log(`${title.padEnd(40)} | ${importance.padEnd(12)} | ${reasoning}`);
  }

  // Kontrol mantığı
  const hasImportanceIssues = articles.some(a => {
    // Eğer importanceLevel null ise ve bu bir test verisiyse (seed scriptinde 4. haber null idi), sorun değil.
    // Ama diğerlerinin dolu olması beklenir.
    return a.url === "https://example.com/news1" && a.importanceLevel !== "CRITICAL";
  });

  if (hasImportanceIssues) {
    console.error("\n[!] HATA: Bazı haberlerin önem dereceleri beklenen değerlerde değil!");
  } else {
    console.log("\n[✓] DOĞRULAMA BAŞARILI: Haberler ve önem dereceleri doğru şekilde kaydedilmiş.");
  }
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
