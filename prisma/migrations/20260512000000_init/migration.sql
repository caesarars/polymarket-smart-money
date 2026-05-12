-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "polymarketId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "slug" TEXT,
    "category" TEXT,
    "endDate" TIMESTAMP(3),
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokenYes" TEXT,
    "tokenNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "smartScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTrade" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "marketId" TEXT,
    "tokenId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "WalletTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletScore" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "pnlScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consistencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specializationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderbookSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "bestBid" DOUBLE PRECISION NOT NULL,
    "bestAsk" DOUBLE PRECISION NOT NULL,
    "spread" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "OrderbookSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_polymarketId_key" ON "Market"("polymarketId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE INDEX "Market_isActive_idx" ON "Market"("isActive");

-- CreateIndex
CREATE INDEX "Market_endDate_idx" ON "Market"("endDate");

-- CreateIndex
CREATE INDEX "Market_category_idx" ON "Market"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_smartScore_idx" ON "Wallet"("smartScore");

-- CreateIndex
CREATE INDEX "Wallet_lastSeenAt_idx" ON "Wallet"("lastSeenAt");

-- CreateIndex
CREATE INDEX "WalletTrade_walletAddress_idx" ON "WalletTrade"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletTrade_marketId_idx" ON "WalletTrade"("marketId");

-- CreateIndex
CREATE INDEX "WalletTrade_tokenId_idx" ON "WalletTrade"("tokenId");

-- CreateIndex
CREATE INDEX "WalletTrade_timestamp_idx" ON "WalletTrade"("timestamp");

-- CreateIndex
CREATE INDEX "WalletScore_walletAddress_idx" ON "WalletScore"("walletAddress");

-- CreateIndex
CREATE INDEX "WalletScore_totalScore_idx" ON "WalletScore"("totalScore");

-- CreateIndex
CREATE INDEX "WalletScore_createdAt_idx" ON "WalletScore"("createdAt");

-- CreateIndex
CREATE INDEX "AlertLog_sentAt_idx" ON "AlertLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertLog_walletAddress_marketId_key" ON "AlertLog"("walletAddress", "marketId");

-- CreateIndex
CREATE INDEX "OrderbookSnapshot_marketId_idx" ON "OrderbookSnapshot"("marketId");

-- CreateIndex
CREATE INDEX "OrderbookSnapshot_tokenId_idx" ON "OrderbookSnapshot"("tokenId");

-- CreateIndex
CREATE INDEX "OrderbookSnapshot_timestamp_idx" ON "OrderbookSnapshot"("timestamp");

-- AddForeignKey
ALTER TABLE "WalletTrade" ADD CONSTRAINT "WalletTrade_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTrade" ADD CONSTRAINT "WalletTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletScore" ADD CONSTRAINT "WalletScore_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderbookSnapshot" ADD CONSTRAINT "OrderbookSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

