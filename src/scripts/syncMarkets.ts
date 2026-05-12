import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { marketService } from "../modules/markets/market.service";

async function main(): Promise<void> {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : 200;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid limit argument: ${limitArg}`);
  }

  logger.info({ limit }, "syncMarkets script: starting");
  const result = await marketService.syncActiveMarkets(limit);
  logger.info(result, "syncMarkets script: done");
}

main()
  .catch((err) => {
    logger.fatal({ err }, "syncMarkets script: failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
  });
