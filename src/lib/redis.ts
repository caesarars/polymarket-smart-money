import IORedis, { Redis, RedisOptions } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

export const redis: Redis = new IORedis(env.REDIS_URL, baseOptions);

redis.on("connect", () => logger.info("Redis connecting"));
redis.on("ready", () => logger.info("Redis ready"));
redis.on("error", (err) => logger.error({ err }, "Redis error"));
redis.on("close", () => logger.warn("Redis connection closed"));

export function createRedisConnection(): Redis {
  return new IORedis(env.REDIS_URL, baseOptions);
}
