-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "lastPrice" DECIMAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "open" DECIMAL NOT NULL,
    "high" DECIMAL NOT NULL,
    "low" DECIMAL NOT NULL,
    "close" DECIMAL NOT NULL,
    "volume" DECIMAL,
    CONSTRAINT "PriceHistory_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountType" TEXT NOT NULL DEFAULT 'PAPER',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "totalBalance" DECIMAL NOT NULL DEFAULT 0,
    "bankAccountNumber" TEXT,
    "iban" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "amount" DECIMAL NOT NULL,
    "balanceAfter" DECIMAL NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "avgCost" DECIMAL NOT NULL DEFAULT 0,
    "totalCost" DECIMAL NOT NULL DEFAULT 0,
    "stopLossPrice" DECIMAL,
    "takeProfitPrice" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Portfolio_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientRequestId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'STOCK',
    "stockId" TEXT,
    "symbol" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "limitPrice" DECIMAL,
    "filledPrice" DECIMAL,
    "filledValue" DECIMAL,
    "commission" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "analysisLogId" TEXT,
    "transactionId" TEXT,
    "sessionId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_analysisLogId_fkey" FOREIGN KEY ("analysisLogId") REFERENCES "AiAnalysisLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "sentiment" TEXT,
    "impactReasoning" TEXT,
    "stockId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsArticle_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAnalysisLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" DECIMAL NOT NULL,
    "reasoning" TEXT NOT NULL,
    "risks" TEXT,
    "rawResponse" TEXT,
    "validationError" TEXT,
    "newsArticleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAnalysisLog_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiAnalysisLog_newsArticleId_fkey" FOREIGN KEY ("newsArticleId") REFERENCES "NewsArticle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoAnalyze" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Watchlist_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "tradingMode" TEXT NOT NULL DEFAULT 'PAPER',
    "liveModeConfirmedAt" DATETIME,
    "aiProvider" TEXT NOT NULL DEFAULT 'GEMINI',
    "geminiApiKey" TEXT NOT NULL DEFAULT '',
    "openaiApiKey" TEXT NOT NULL DEFAULT '',
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "openaiModel" TEXT NOT NULL DEFAULT 'gpt-4o',
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
    "autoTradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoTradeIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "newsSources" TEXT NOT NULL DEFAULT '["GOOGLE_NEWS"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "requestBody" TEXT NOT NULL,
    "responseBody" TEXT,
    "httpStatus" INTEGER,
    "errorClass" TEXT,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "resultSummary" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Stock_symbol_key" ON "Stock"("symbol");

-- CreateIndex
CREATE INDEX "PriceHistory_stockId_timestamp_idx" ON "PriceHistory"("stockId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Account_accountType_idx" ON "Account"("accountType");

-- CreateIndex
CREATE INDEX "AccountTransaction_accountId_createdAt_idx" ON "AccountTransaction"("accountId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_stockId_key" ON "Portfolio"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_stockId_createdAt_idx" ON "Order"("stockId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_urlHash_key" ON "NewsArticle"("urlHash");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "NewsArticle_stockId_idx" ON "NewsArticle"("stockId");

-- CreateIndex
CREATE INDEX "AiAnalysisLog_stockId_createdAt_idx" ON "AiAnalysisLog"("stockId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_stockId_key" ON "Watchlist"("stockId");

-- CreateIndex
CREATE INDEX "ApiCallLog_endpoint_createdAt_idx" ON "ApiCallLog"("endpoint", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobRun_jobType_startedAt_idx" ON "JobRun"("jobType", "startedAt" DESC);
