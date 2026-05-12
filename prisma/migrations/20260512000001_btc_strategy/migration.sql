-- AlterTable: AlertLog — make wallet/market optional, add signal fields, drop old unique constraint
ALTER TABLE "AlertLog" ALTER COLUMN "walletAddress" DROP NOT NULL;
ALTER TABLE "AlertLog" ALTER COLUMN "marketId" DROP NOT NULL;
ALTER TABLE "AlertLog" ADD COLUMN IF NOT EXISTS "signalId" TEXT;
ALTER TABLE "AlertLog" ADD COLUMN IF NOT EXISTS "side" TEXT;
ALTER TABLE "AlertLog" ADD COLUMN IF NOT EXISTS "cooldownKey" TEXT;

-- Drop old unique constraint / index (walletAddress, marketId)
-- Note: init migration created this as a UNIQUE INDEX, not a CONSTRAINT.
ALTER TABLE "AlertLog" DROP CONSTRAINT IF EXISTS "AlertLog_walletAddress_marketId_key";
DROP INDEX IF EXISTS "AlertLog_walletAddress_marketId_key";

-- CreateIndex: AlertLog new indexes
CREATE INDEX IF NOT EXISTS "AlertLog_marketId_idx" ON "AlertLog"("marketId");
CREATE INDEX IF NOT EXISTS "AlertLog_side_idx" ON "AlertLog"("side");
CREATE INDEX IF NOT EXISTS "AlertLog_cooldownKey_idx" ON "AlertLog"("cooldownKey");

-- CreateTable: BtcMarketSnapshot
CREATE TABLE IF NOT EXISTS "BtcMarketSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "bestBid" DECIMAL(18,8) NOT NULL,
    "bestAsk" DECIMAL(18,8) NOT NULL,
    "midPrice" DECIMAL(18,8) NOT NULL,
    "spread" DECIMAL(18,8) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "BtcMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: BtcMarketSnapshot
CREATE INDEX IF NOT EXISTS "BtcMarketSnapshot_marketId_idx" ON "BtcMarketSnapshot"("marketId");
CREATE INDEX IF NOT EXISTS "BtcMarketSnapshot_timestamp_idx" ON "BtcMarketSnapshot"("timestamp");

-- AddForeignKey: BtcMarketSnapshot -> Market
ALTER TABLE "BtcMarketSnapshot" ADD CONSTRAINT "BtcMarketSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: BtcSignal
CREATE TABLE IF NOT EXISTS "BtcSignal" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "polymarketProbability" DECIMAL(18,8) NOT NULL,
    "modelProbability" DECIMAL(18,8) NOT NULL,
    "edge" DECIMAL(18,8) NOT NULL,
    "confidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "BtcSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: BtcSignal
CREATE INDEX IF NOT EXISTS "BtcSignal_marketId_idx" ON "BtcSignal"("marketId");
CREATE INDEX IF NOT EXISTS "BtcSignal_timestamp_idx" ON "BtcSignal"("timestamp");
CREATE INDEX IF NOT EXISTS "BtcSignal_side_idx" ON "BtcSignal"("side");

-- AddForeignKey: BtcSignal -> Market
ALTER TABLE "BtcSignal" ADD CONSTRAINT "BtcSignal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
