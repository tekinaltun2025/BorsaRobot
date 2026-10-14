-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "tradingMode" TEXT NOT NULL DEFAULT 'PAPER',
    "liveModeConfirmedAt" DATETIME,
    "aiProvider" TEXT NOT NULL DEFAULT 'GEMINI',
    "geminiApiKey" TEXT NOT NULL DEFAULT '',
    "openaiApiKey" TEXT NOT NULL DEFAULT '',
    "anthropicApiKey" TEXT NOT NULL DEFAULT '',
    "deepseekApiKey" TEXT NOT NULL DEFAULT '',
    "grokApiKey" TEXT NOT NULL DEFAULT '',
    "mistralApiKey" TEXT NOT NULL DEFAULT '',
    "nvidiaApiKey" TEXT NOT NULL DEFAULT '',
    "customBaseUrl" TEXT,
    "customApiKey" TEXT NOT NULL DEFAULT '',
    "customModel" TEXT NOT NULL DEFAULT '',
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "openaiModel" TEXT NOT NULL DEFAULT 'gpt-4o',
    "anthropicModel" TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
    "deepseekModel" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "grokModel" TEXT NOT NULL DEFAULT 'grok-4',
    "mistralModel" TEXT NOT NULL DEFAULT 'mistral-small-latest',
    "nvidiaModel" TEXT NOT NULL DEFAULT 'moonshotai/kimi-k3',
    "systemPrompt" TEXT NOT NULL,
    "newsScanPrompt" TEXT NOT NULL,
    "stopLossPercent" DECIMAL NOT NULL DEFAULT 5,
    "takeProfitPercent" DECIMAL NOT NULL DEFAULT 10,
    "commissionRate" DECIMAL NOT NULL DEFAULT 0.1,
    "minConfidenceThreshold" DECIMAL NOT NULL DEFAULT 0.7,
    "maxPositionValue" DECIMAL NOT NULL DEFAULT 50000,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 5,
    "dailyOrderBudget" DECIMAL NOT NULL DEFAULT 100000,
    "maxDailyLossLimit" DECIMAL NOT NULL DEFAULT 5000,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "priceSource" TEXT NOT NULL DEFAULT 'YAHOO',
    "autoTradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoTradeIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "autoTradeApprovalMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "maxBuyAmount" DECIMAL NOT NULL DEFAULT 10000,
    "maxSellAmount" DECIMAL NOT NULL DEFAULT 10000,
    "newsSources" TEXT NOT NULL DEFAULT '["GOOGLE_NEWS"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AdminSettings" ("aiProvider", "anthropicApiKey", "anthropicModel", "autoTradeApprovalMode", "autoTradeIntervalSeconds", "autoTradingEnabled", "commissionRate", "cooldownMinutes", "createdAt", "customApiKey", "customBaseUrl", "customModel", "dailyOrderBudget", "deepseekApiKey", "deepseekModel", "geminiApiKey", "geminiModel", "grokApiKey", "grokModel", "id", "liveModeConfirmedAt", "maxBuyAmount", "maxOpenPositions", "maxPositionValue", "maxSellAmount", "minConfidenceThreshold", "mistralApiKey", "mistralModel", "newsScanPrompt", "newsSources", "nvidiaApiKey", "nvidiaModel", "openaiApiKey", "openaiModel", "priceSource", "stopLossPercent", "systemPrompt", "takeProfitPercent", "tradingMode", "updatedAt") SELECT "aiProvider", "anthropicApiKey", "anthropicModel", "autoTradeApprovalMode", "autoTradeIntervalSeconds", "autoTradingEnabled", "commissionRate", "cooldownMinutes", "createdAt", "customApiKey", "customBaseUrl", "customModel", "dailyOrderBudget", "deepseekApiKey", "deepseekModel", "geminiApiKey", "geminiModel", "grokApiKey", "grokModel", "id", "liveModeConfirmedAt", "maxBuyAmount", "maxOpenPositions", "maxPositionValue", "maxSellAmount", "minConfidenceThreshold", "mistralApiKey", "mistralModel", "newsScanPrompt", "newsSources", "nvidiaApiKey", "nvidiaModel", "openaiApiKey", "openaiModel", "priceSource", "stopLossPercent", "systemPrompt", "takeProfitPercent", "tradingMode", "updatedAt" FROM "AdminSettings";
DROP TABLE "AdminSettings";
ALTER TABLE "new_AdminSettings" RENAME TO "AdminSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
