import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TradingMode } from "@/lib/types";
import { PaperTradingProvider } from "@/server/providers/paper-trading-provider";
import { LiveTradingProvider } from "@/server/providers/live-trading-provider";
import {
  createDenizBankClient,
  DenizBankBaseClient,
} from "@/server/providers/denizbank/denizbank-base-client";
import type { ITradingProvider } from "@/server/providers/trading-provider";

/**
 * Çalışma zamanı sağlayıcı seçimi — mod anahtarının kod karşılığı (Bölüm 4.5).
 *
 * Her istekte AdminSettings.tradingMode okunur; mod değiştiğinde yeni
 * provider örneği döner. Provider örnekleri kalıcı durum tutmaz (stateless) —
 * tüm durum veritabanındadır; bu, mod geçişlerinde yarım kalan işlem
 * riskini sıfırlar. Komisyon oranı her çözümlemede AdminSettings'ten taze
 * okunur, böylece admin'in oran değişikliği anında etkili olur.
 */

/**
 * DenizBank istemcisi — process ömrü boyunca tek örnek (lazy singleton).
 *
 * DenizBankBaseClient stateless'tır: Header GUID'leri her istekte
 * crypto.randomUUID() ile taze üretilir, asla örnekte tutulmaz. Singleton
 * yalnızca gereksiz yeniden kurulumu (env okuma, mock transport state'i)
 * önler. Mock transport'ın failure-injection planı da bu örnek üzerinde
 * yaşar; testler bu örneğe `getBankClient()` üzerinden erişir.
 */
let bankClientSingleton: DenizBankBaseClient | null = null;

/** DenizBank istemcisini (gerekirse kurarak) döndürür. */
export function getBankClient(): DenizBankBaseClient {
  bankClientSingleton ??= createDenizBankClient();
  return bankClientSingleton;
}

/**
 * Mevcut AdminSettings.tradingMode'a göre provider döndüren kısayol.
 *
 * Ayar kaydı yoksa PAPER varsayılır (getOrCreateAdminSettings burada
 * çağrılmaz: factory okuma-yalnız kalmalı; ayar oluşturma API katmanının
 * sorumluluğudur).
 *
 * Not (iyileştirme 4.1): eski senkron `getTradingProvider(mode)` fonksiyonu
 * kaldırıldı — komisyonu hardcoded 0.1 ile kurup admin ayarını yok sayıyordu
 * ve hiçbir çağıranı yoktu. Tüm akışlar bu async fonksiyonu kullanır.
 */
export async function resolveTradingProvider(): Promise<ITradingProvider> {
  const settings = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
    select: { tradingMode: true, commissionRate: true },
  });

  const mode = (settings?.tradingMode as TradingMode | null) ?? "PAPER";

  if (mode === "LIVE") {
    return new LiveTradingProvider(prisma, getBankClient());
  }

  const commissionRate = settings?.commissionRate ?? new Prisma.Decimal(0.1);
  return new PaperTradingProvider(prisma, commissionRate);
}
