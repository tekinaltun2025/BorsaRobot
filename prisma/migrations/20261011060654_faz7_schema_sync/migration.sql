-- AlterTable
ALTER TABLE "Account" ADD COLUMN "ownerId" TEXT;

-- CreateTable
CREATE TABLE "AiDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobRunId" TEXT,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "research" TEXT,
    "reasoning" TEXT,
    "innerMonologue" TEXT,
    "confidence" INTEGER,
    "orderPlaced" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL,
    "price" DECIMAL,
    "skipReason" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockId" TEXT,
    CONSTRAINT "AiDecisionLog_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiDecisionChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PnlReset" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "resetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "priceSource" TEXT NOT NULL DEFAULT 'YAHOO',
    "autoTradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoTradeIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "newsSources" TEXT NOT NULL DEFAULT '["GOOGLE_NEWS"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AdminSettings" ("aiProvider", "autoTradeIntervalSeconds", "autoTradingEnabled", "commissionRate", "cooldownMinutes", "createdAt", "dailyOrderBudget", "geminiApiKey", "geminiModel", "id", "liveModeConfirmedAt", "maxOpenPositions", "maxPositionValue", "minConfidenceThreshold", "newsScanPrompt", "newsSources", "openaiApiKey", "openaiModel", "stopLossPercent", "systemPrompt", "takeProfitPercent", "tradingMode", "updatedAt") SELECT "aiProvider", "autoTradeIntervalSeconds", "autoTradingEnabled", "commissionRate", "cooldownMinutes", "createdAt", "dailyOrderBudget", "geminiApiKey", "geminiModel", "id", "liveModeConfirmedAt", "maxOpenPositions", "maxPositionValue", "minConfidenceThreshold", "newsScanPrompt", "newsSources", "openaiApiKey", "openaiModel", "stopLossPercent", "systemPrompt", "takeProfitPercent", "tradingMode", "updatedAt" FROM "AdminSettings";
DROP TABLE "AdminSettings";
ALTER TABLE "new_AdminSettings" RENAME TO "AdminSettings";
CREATE TABLE "new_Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoAnalyze" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "Watchlist_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Watchlist" ("autoAnalyze", "createdAt", "id", "stockId") SELECT "autoAnalyze", "createdAt", "id", "stockId" FROM "Watchlist";
DROP TABLE "Watchlist";
ALTER TABLE "new_Watchlist" RENAME TO "Watchlist";
CREATE UNIQUE INDEX "Watchlist_stockId_key" ON "Watchlist"("stockId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AiDecisionLog_createdAt_idx" ON "AiDecisionLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiDecisionLog_symbol_idx" ON "AiDecisionLog"("symbol");

-- CreateIndex
CREATE INDEX "AiDecisionLog_stockId_idx" ON "AiDecisionLog"("stockId");

-- CreateIndex
CREATE INDEX "AiDecisionChat_createdAt_idx" ON "AiDecisionChat"("createdAt" DESC);
