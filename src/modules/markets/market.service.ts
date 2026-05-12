import { Market } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { gammaClient } from "../polymarket/gamma.client";
import {
  GammaMarket,
  GammaNestedEvent,
  GammaTag,
} from "../polymarket/polymarket.types";

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

function tagLabel(tag: GammaTag): string | null {
  if (typeof tag === "string") {
    const s = tag.trim();
    return s.length > 0 ? s : null;
  }
  if (tag && typeof tag === "object") {
    if (typeof tag.label === "string" && tag.label.trim()) return tag.label.trim();
    if (typeof tag.slug === "string" && tag.slug.trim()) return tag.slug.trim();
  }
  return null;
}

function firstTag(tags: GammaTag[] | undefined): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const label = tagLabel(t);
    if (label) return label;
  }
  return null;
}

/**
 * Resolve a market's display category. Gamma's modern responses often leave
 * `market.category` empty — the canonical category lives on the parent event,
 * with a tags array as a final fallback.
 */
function extractCategory(m: GammaMarket): string | null {
  if (typeof m.category === "string" && m.category.trim()) {
    return m.category.trim();
  }
  if (Array.isArray(m.events)) {
    for (const e of m.events as GammaNestedEvent[]) {
      if (typeof e?.category === "string" && e.category.trim()) {
        return e.category.trim();
      }
      const fromEventTags = firstTag(e?.tags);
      if (fromEventTags) return fromEventTags;
    }
  }
  return firstTag(m.tags);
}

/**
 * Check whether a Polymarket market is a BTC short-duration prediction market.
 *
 * Matches terms like "btc", "bitcoin", "5 minute", "5 minutes", "5m",
 * "15 minute", "15 minutes", "15m" in the question, slug, title, description,
 * or tags. Avoids unrelated long-term BTC markets unless they are clearly 5m/15m.
 */
export function isBtcShortDurationMarket(m: GammaMarket): boolean {
  const haystack = [
    m.question,
    m.slug,
    typeof m.description === "string" ? m.description : "",
    ...(Array.isArray(m.tags) ? m.tags.map((t) => tagLabel(t) ?? "") : []),
    ...(Array.isArray(m.events)
      ? (m.events as GammaNestedEvent[]).map((e) => e.title ?? "")
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasBtc = /\b(btc|bitcoin)\b/.test(haystack);
  if (!hasBtc) return false;

  const hasShortDuration =
    /\b(5\s*minute|5\s*minutes|5m|15\s*minute|15\s*minutes|15m)\b/.test(haystack);

  return hasShortDuration;
}

export class MarketService {
  /**
   * Sync active markets from the Gamma API into Postgres. Paginates so we
   * actually cover the whole catalog (Polymarket has thousands of active
   * markets), and orders by volume descending so the highest-traffic
   * markets always make it in even if `maxMarkets` is small.
   *
   * Only BTC 5m/15m markets are retained; everything else is skipped.
   * Idempotent: uses polymarketId as the upsert key.
   */
  async syncActiveMarkets(
    maxMarkets = 2000,
    opts: { category?: string } = {},
  ): Promise<{ synced: number; pages: number }> {
    const pageSize = 100;
    let offset = 0;
    let synced = 0;
    let pages = 0;

    while (offset < maxMarkets) {
      const limit = Math.min(pageSize, maxMarkets - offset);
      const markets = await gammaClient.getMarkets({
        active: true,
        closed: false,
        limit,
        offset,
        order: "volume",
        ascending: false,
        ...(opts.category ? { category: opts.category } : {}),
      });

      if (markets.length === 0) break;
      pages += 1;

      for (const m of markets) {
        const polymarketId = String(m.id ?? m.conditionId ?? "").trim();
        if (!polymarketId) continue;

        // --- BTC 5m/15m filter ---
        if (!isBtcShortDurationMarket(m)) {
          logger.debug(
            { polymarketId, question: m.question },
            "MarketService: skipped non-BTC-short-duration market",
          );
          continue;
        }

        const tokenIds = parseTokenIds(m.clobTokenIds);
        const [tokenYes, tokenNo] = [tokenIds[0] ?? null, tokenIds[1] ?? null];

        try {
          await prisma.market.upsert({
            where: { polymarketId },
            create: {
              polymarketId,
              question: m.question ?? "(unknown)",
              slug: m.slug ?? null,
              category: extractCategory(m),
              endDate: parseEndDate(m.endDate),
              volume: toNumber(m.volume),
              tokenYes,
              tokenNo,
              isActive: m.active !== false && m.closed !== true,
            },
            update: {
              question: m.question ?? "(unknown)",
              slug: m.slug ?? null,
              category: extractCategory(m),
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

      // Page wasn't full → no more results from Gamma.
      if (markets.length < limit) break;
      offset += limit;
    }

    if (synced === 0) {
      logger.warn(
        { opts },
        "MarketService.syncActiveMarkets: no markets returned",
      );
    } else {
      logger.info(
        { synced, pages, opts },
        "MarketService: sync complete",
      );
    }
    return { synced, pages };
  }

  async getActiveMarkets(
    limit = 100,
    opts: { category?: string } = {},
  ): Promise<Market[]> {
    return prisma.market.findMany({
      where: {
        isActive: true,
        ...(opts.category ? { category: opts.category } : {}),
      },
      orderBy: [{ volume: "desc" }, { endDate: "asc" }],
      take: limit,
    });
  }

  /**
   * Distinct categories present in the DB, with counts. Used by the dashboard
   * to populate a category filter dropdown.
   */
  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    const rows = await prisma.market.groupBy({
      by: ["category"],
      where: { isActive: true, NOT: { category: null } },
      _count: { _all: true },
      orderBy: { _count: { category: "desc" } },
    });
    return rows
      .filter((r): r is typeof r & { category: string } => r.category !== null)
      .map((r) => ({ category: r.category, count: r._count._all }));
  }

  async getByPolymarketId(polymarketId: string): Promise<Market | null> {
    return prisma.market.findUnique({ where: { polymarketId } });
  }

  async getById(id: string): Promise<Market | null> {
    return prisma.market.findUnique({ where: { id } });
  }
}

export const marketService = new MarketService();
