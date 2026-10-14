import { prisma } from "@/lib/prisma";

async function seed() {
  try {
    console.log("Seeding dummy news articles...");
    
    // Clear existing news to avoid duplicates for this test
    await prisma.newsArticle.deleteMany({});
    
    // First, find the stock ID for AEFES
    const stock = await prisma.stock.findUnique({ where: { symbol: "AEFES" } });
    if (!stock) {
      throw new Error("Stock AEFES not found in database. Please run seed/sync first.");
    }
    const stockId = stock.id;
    
    await prisma.newsArticle.createMany({
      data: [
        {
          stockId,
          title: "AEFES Çok İyi Kazanç Açıkladı",
          summary: "Anadolu Efes, yılın üçüncü çeyreğinde rekor kar açıkladı.",
          url: "https://example.com/news1",
          urlHash: "hash1",
          source: "Ekonomi Haber",
          publishedAt: new Date(),
          importanceLevel: "CRITICAL"
        },
        {
          stockId,
          title: "AEFES Yeni Yatırım Planı",
          summary: "Şirket yeni bir üretim tesisi kuracağını duyurdu.",
          url: "https://example.com/news2",
          urlHash: "hash2",
          source: "Finans Dünyası",
          publishedAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
          importanceLevel: "IMPORTANT"
        },
        {
          stockId,
          title: "AEFES Hakkında Sıradan Bir Haber",
          summary: "Şirket hakkında genel bir bilgilendirme.",
          url: "https://example.com/news3",
          urlHash: "hash3",
          source: "Haber Ajansı",
          publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
          importanceLevel: "IMPORTANT"
        },
        {
          stockId,
          title: "AEFES Hisse Analizi",
          summary: "Teknik analiz sonuçları paylaşıldı.",
          url: "https://example.com/news4",
          urlHash: "hash4",
          source: "Borsa Analiz",
          publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago
          importanceLevel: null // Test case for null importance
        }
      ]
    });

    console.log("Seeding completed successfully.");
  } catch (error) {
    console.error("Error seeding news:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
