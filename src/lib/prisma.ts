import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "./logger";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

process.on("beforeExit", () => {
  logger.info("Disconnecting Prisma client");
});
