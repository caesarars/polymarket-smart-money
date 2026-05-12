import { Market } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { gammaClient } from "../polymarket/gamma.client";
import { GammaMarket } from "../polymarket/polymarket.types";

function parseTokenIds(raw: GammaMarket["clobTokenIds"]): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON — fall through
  }
  // Some gamma responses use comma-separated strings.
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseEndDate(raw: GammaMarket["endDate"]): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class MarketService {
  /**
   * Sync the latest active markets from the Gamma API into Postgres.
   * Idempotent: uses polymarketId as the upsert key.
   */
  async syncActiveMarkets(limit = 200): Promise<{ synced: number }> {
    const markets = await gammaClient.getMarkets({
      active: true,
      closed: false,
      limit,
    });
    if (markets.length === 0) {
      logger.warn("MarketService.syncActiveMarkets: no markets returned");
      return { synced: 0 };
    }

    let synced = 0;
    for (const m of markets) {
      const polymarketId = String(m.id ?? m.conditionId ?? "").trim();
      if (!polymarketId) continue;

      const tokenIds = parseTokenIds(m.clobTokenIds);
      const [tokenYes, tokenNo] = [tokenIds[0] ?? null, tokenIds[1] ?? null];

      try {
        await prisma.market.upsert({
          where: { polymarketId },
          create: {
            polymarketId,
            question: m.question ?? "(unknown)",
            slug: m.slug ?? null,
            category: m.category ?? null,
            endDate: parseEndDate(m.endDate),
            volume: toNumber(m.volume),
            tokenYes,
            tokenNo,
            isActive: m.active !== false && m.closed !== true,
          },
          update: {
            question: m.question ?? "(unknown)",
            slug: m.slug ?? null,
            category: m.category ?? null,
            endDate: parseEndDate(m.endDate),
            volume: toNumber(m.volume),
            tokenYes,
            tokenNo,
            isActive: m.active !== false && m.closed !== true,
          },
        });
        synced += 1;
      } catch (err) {
        logger.error({ err, polymarketId }, "MarketService: upsert failed");
      }
    }

    logger.info({ synced, total: markets.length }, "MarketService: sync complete");
    return { synced };
  }

  async getActiveMarkets(limit = 100): Promise<Market[]> {
    return prisma.market.findMany({
      where: { isActive: true },
      orderBy: [{ volume: "desc" }, { endDate: "asc" }],
      take: limit,
    });
  }

  async getByPolymarketId(polymarketId: string): Promise<Market | null> {
    return prisma.market.findUnique({ where: { polymarketId } });
  }

  async getById(id: string): Promise<Market | null> {
    return prisma.market.findUnique({ where: { id } });
  }
}

export const marketService = new MarketService();
