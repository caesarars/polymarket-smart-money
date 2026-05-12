import { z } from "zod";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { pipelineService } from "../modules/pipeline/pipeline.service";

const argSchema = z.object({
  topMarkets: z.coerce.number().int().min(1).max(500).optional(),
  tradesPerMarket: z.coerce.number().int().min(1).max(1000).optional(),
  holdersPerMarket: z.coerce.number().int().min(0).max(500).optional(),
});

function parseArgs(): z.infer<typeof argSchema> {
  const flags: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) flags[m[1]] = m[2];
  }
  const parsed = argSchema.safeParse(flags);
  if (!parsed.success) {
    logger.fatal({ errors: parsed.error.flatten() }, "Invalid CLI arguments");
    process.exit(1);
  }
  return parsed.data;
}

async function main(): Promise<void> {
  const args = parseArgs();
  logger.info({ args }, "runPipeline: starting");
  const summary = await pipelineService.runOnce(args);
  logger.info({ summary }, "runPipeline: done");
}

main()
  .catch((err) => {
    logger.fatal({ err }, "runPipeline: failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
  });
