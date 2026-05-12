/**
 * One-off cleanup script: deactivate all non-BTC markets in the database.
 *
 * Run with:
 *   npx tsx src/scripts/cleanupNonBtcMarkets.ts
 *
 * This prevents the signal scanner and CLOB WebSocket from touching old
 * smart-money markets that were synced before the BTC-focused refactor.
 */
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

function isBtcMarket(question: string | null, slug: string | null): boolean {
  const haystack = [question, slug].filter(Boolean).join(" ").toLowerCase();
  const hasBtc = /\b(btc|bitcoin)\b/.test(haystack);
  const hasShortDuration =
    /\b(5\s*minute|5\s*minutes|5m|15\s*minute|15\s*minutes|15m)\b/.test(haystack);
  return hasBtc && hasShortDuration;
}

async function main(): Promise<void> {
  logger.info("Starting non-BTC market cleanup");

  const allActive = await prisma.market.findMany({
    where: { isActive: true },
    select: { id: true, question: true, slug: true },
  });

  const toDeactivate = allActive.filter(
    (m) => !isBtcMarket(m.question, m.slug),
  );

  if (toDeactivate.length === 0) {
    logger.info("No non-BTC markets to deactivate");
    return;
  }

  const ids = toDeactivate.map((m) => m.id);
  const result = await prisma.market.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false },
  });

  logger.info(
    { scanned: allActive.length, deactivatedCount: result.count },
    "Non-BTC market cleanup complete",
  );
}

main()
  .catch((err) => {
    logger.fatal({ err }, "Cleanup failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
