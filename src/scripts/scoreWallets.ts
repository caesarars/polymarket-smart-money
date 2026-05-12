import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { walletScoring } from "../modules/wallets/wallet.scoring";

async function main(): Promise<void> {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : 500;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid limit argument: ${limitArg}`);
  }

  logger.info({ limit }, "scoreWallets script: starting");
  const scored = await walletScoring.scoreAll(limit);
  logger.info({ scored }, "scoreWallets script: done");
}

main()
  .catch((err) => {
    logger.fatal({ err }, "scoreWallets script: failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
  });
