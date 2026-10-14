import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { maskApiKey } from "@/lib/utils";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import type {
  AdminSettingsUpdateInput,
  AdminSettingsView,
  AutoTradeApprovalMode,
  NewsSourceId,
  PriceSourceKind,
  TradingMode,
} from "@/lib/types";

/**
 * AdminSettings kaydını client'a taşınabilir görünüme dönüştürür.
 *
 * GÜVENLİK: API anahtarları asla plain döndürülmez — yalnızca maskeli
 * halleri (son 4 karakter) view'e dahil edilir.
 */
export function toAdminSettingsView(
  settings: {
    id: string;
    tradingMode: string;
    liveModeConfirmedAt: Date | null;
    aiProvider: string;
    geminiApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    deepseekApiKey: string;
    grokApiKey: string;
    mistralApiKey: string;
    nvidiaApiKey: string;
    customBaseUrl: string | null;
    customApiKey: string;
    customModel: string;
    geminiModel: string;
    openaiModel: string;
    anthropicModel: string;
    deepseekModel: string;
    grokModel: string;
    mistralModel: string;
    nvidiaModel: string;
    systemPrompt: string;
    newsScanPrompt: string;
    stopLossPercent: unknown;
    takeProfitPercent: unknown;
    minConfidenceThreshold: unknown;
    maxPositionValue: unknown;
    maxOpenPositions: number;
    dailyOrderBudget: unknown;
    cooldownMinutes: number;
    autoTradingEnabled: boolean;
    autoTradeIntervalSeconds: number;
    autoTradeApprovalMode: string;
    maxDailyLossLimit: unknown;
    maxBuyAmount: unknown;
    maxSellAmount: unknown;
    priceSource: string;
    newsSources: string;
    updatedAt: Date;
  },
): AdminSettingsView {
  return {
    id: settings.id,
    tradingMode: settings.tradingMode as TradingMode,
    liveModeConfirmedAt:
      settings.liveModeConfirmedAt?.toISOString() ?? null,
    aiProvider: settings.aiProvider as AdminSettingsView["aiProvider"],
    // Maskeli görünüm: önce decrypt (DB'de şifreli), sonra mask (son 4 karakter).
    geminiApiKeyMasked: maskApiKey(decryptSecret(settings.geminiApiKey)),
    openaiApiKeyMasked: maskApiKey(decryptSecret(settings.openaiApiKey)),
    anthropicApiKeyMasked: maskApiKey(decryptSecret(settings.anthropicApiKey)),
    deepseekApiKeyMasked: maskApiKey(decryptSecret(settings.deepseekApiKey)),
    grokApiKeyMasked: maskApiKey(decryptSecret(settings.grokApiKey)),
    mistralApiKeyMasked: maskApiKey(decryptSecret(settings.mistralApiKey)),
    nvidiaApiKeyMasked: maskApiKey(decryptSecret(settings.nvidiaApiKey)),
    customApiKeyMasked: maskApiKey(decryptSecret(settings.customApiKey)),
    customBaseUrl: settings.customBaseUrl,
    customModel: settings.customModel,
    geminiModel: settings.geminiModel,
    openaiModel: settings.openaiModel,
    anthropicModel: settings.anthropicModel,
    deepseekModel: settings.deepseekModel,
    grokModel: settings.grokModel,
    mistralModel: settings.mistralModel,
    nvidiaModel: settings.nvidiaModel,
    systemPrompt: settings.systemPrompt,
    newsScanPrompt: settings.newsScanPrompt,
    stopLossPercent: Number(settings.stopLossPercent),
    takeProfitPercent: Number(settings.takeProfitPercent),
    minConfidenceThreshold: Number(settings.minConfidenceThreshold),
    maxPositionValue: Number(settings.maxPositionValue),
    maxOpenPositions: settings.maxOpenPositions,
    dailyOrderBudget: Number(settings.dailyOrderBudget),
    cooldownMinutes: settings.cooldownMinutes,
    autoTradingEnabled: settings.autoTradingEnabled,
    autoTradeIntervalSeconds: settings.autoTradeIntervalSeconds,
    autoTradeApprovalMode: settings.autoTradeApprovalMode as AutoTradeApprovalMode,
    maxDailyLossLimit: Number(settings.maxDailyLossLimit),
    maxBuyAmount: Number(settings.maxBuyAmount),
    maxSellAmount: Number(settings.maxSellAmount),
    priceSource: settings.priceSource as PriceSourceKind,
    newsSources: JSON.parse(settings.newsSources) as NewsSourceId[],
    updatedAt: settings.updatedAt.toISOString(),
  };
}

/**
 * Zod doğrulamasından geçmiş kısmi güncellemeyi Prisma update verisine
 * çevirir (iyileştirme 4.4 — route'taki 45 satırlık if-zincirinin tek
 * kaynaklı hali).
 *
 * Kurallar:
 *  - Yalnızca gönderilen (undefined olmayan) alanlar güncellemeye girer.
 *  - GÜVENLİK: API anahtarları AES-256-GCM ile şifrelenerek yazılır.
 *  - customBaseUrl: boş string = temizle (NULL), dolu string = trim'li değer.
 *  - newsSources: dizi → JSON string.
 *  - tradingMode LIVE'a geçerken liveModeConfirmedAt damgası basılır.
 */
export function buildAdminSettingsUpdateData(
  update: AdminSettingsUpdateInput,
): Prisma.AdminSettingsUpdateInput {
  const data: Prisma.AdminSettingsUpdateInput = {};

  // Doğrudan kopyalanan alanlar — undefined olanlar atlanır.
  const directFields = [
    "tradingMode",
    "aiProvider",
    "customModel",
    "geminiModel",
    "openaiModel",
    "anthropicModel",
    "deepseekModel",
    "grokModel",
    "mistralModel",
    "nvidiaModel",
    "systemPrompt",
    "newsScanPrompt",
    "stopLossPercent",
    "takeProfitPercent",
    "minConfidenceThreshold",
    "maxPositionValue",
    "maxOpenPositions",
    "dailyOrderBudget",
    "cooldownMinutes",
    "autoTradingEnabled",
    "autoTradeIntervalSeconds",
    "autoTradeApprovalMode",
    "maxBuyAmount",
    "maxSellAmount",
    "priceSource",
  ] as const;
  for (const field of directFields) {
    const value = update[field];
    if (value !== undefined) {
      // Prisma tip genişlemesi: alan adı anahtar olarak atanabilir.
      (data as Record<string, unknown>)[field] = value;
    }
  }

  // GÜVENLİK: API anahtarları DB'ye yazılmadan önce şifrelenir.
  const secretFields = [
    "geminiApiKey",
    "openaiApiKey",
    "anthropicApiKey",
    "deepseekApiKey",
    "grokApiKey",
    "mistralApiKey",
    "nvidiaApiKey",
    "customApiKey",
  ] as const;
  for (const field of secretFields) {
    const value = update[field];
    if (value !== undefined) {
      (data as Record<string, unknown>)[field] = encryptSecret(value);
    }
  }

  // Özel dönüşümler.
  if (update.customBaseUrl !== undefined) {
    // Boş string = temizle (NULL'a çek); dolu string = yeni base URL.
    const trimmed = update.customBaseUrl.trim();
    data.customBaseUrl = trimmed === "" ? null : trimmed;
  }
  if (update.newsSources !== undefined) {
    data.newsSources = JSON.stringify(update.newsSources);
  }
  if (update.tradingMode === "LIVE") {
    data.liveModeConfirmedAt = new Date();
  }

  return data;
}

/**
 * Singleton AdminSettings kaydını getirir; yoksa seed varsayılanlarıyla oluşturur.
 * (DB sıfırlandığında API'nin boş yanıta düşmesini önler.)
 */
export async function getAdminSettings() {
  return getOrCreateAdminSettings();
}

export async function getOrCreateAdminSettings() {
  const existing = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) return existing;

  const { DEFAULT_SYSTEM_PROMPT, DEFAULT_NEWS_SCAN_PROMPT, DEFAULT_RISK_SETTINGS } =
    await import("@/lib/constants");

  return prisma.adminSettings.create({
    data: {
      id: "singleton",
      tradingMode: "PAPER",
      aiProvider: "GEMINI",
      geminiApiKey: encryptSecret(process.env.GEMINI_API_KEY ?? ""),
      openaiApiKey: encryptSecret(process.env.OPENAI_API_KEY ?? ""),
      anthropicApiKey: encryptSecret(process.env.ANTHROPIC_API_KEY ?? ""),
      deepseekApiKey: encryptSecret(process.env.DEEPSEEK_API_KEY ?? ""),
      grokApiKey: encryptSecret(process.env.GROK_API_KEY ?? ""),
      mistralApiKey: encryptSecret(process.env.MISTRAL_API_KEY ?? ""),
      nvidiaApiKey: encryptSecret(process.env.NVIDIA_API_KEY ?? ""),
      customBaseUrl: process.env.CUSTOM_BASE_URL || null,
      customApiKey: encryptSecret(process.env.CUSTOM_API_KEY ?? ""),
      customModel: process.env.CUSTOM_MODEL ?? "",
      geminiModel: "gemini-2.0-flash",
      openaiModel: "gpt-4o",
      anthropicModel: "claude-sonnet-4-5",
      deepseekModel: "deepseek-chat",
      grokModel: "grok-4",
      mistralModel: "mistral-small-latest",
      nvidiaModel: "moonshotai/kimi-k3",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      newsScanPrompt: DEFAULT_NEWS_SCAN_PROMPT,
      ...DEFAULT_RISK_SETTINGS,
      autoTradingEnabled: false,
      autoTradeIntervalSeconds: 60,
      autoTradeApprovalMode: "MANUAL",
      maxBuyAmount: 10000,
      maxSellAmount: 10000,
      priceSource: process.env.PRICE_SOURCE?.trim().toUpperCase() === "SIMULATED"
        ? "SIMULATED"
        : "YAHOO",
      newsSources: '["GOOGLE_NEWS"]',
    },
  });
}
