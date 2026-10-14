import { PrismaClient } from "@prisma/client";

/**
 * Global singleton Prisma client.
 *
 * Next.js development modunda hot-reload sırasında aynı process içinde
 * birden fazla PrismaClient örneği açılmasını engeller (bağlantı havuzu
 * tükenmesi / SQLite kilit hataları önlenir).
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
