import { Wallet, WalletScore, WalletTrade } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

export interface ScoreBreakdown {
  pnlScore: number;
  timingScore: number;
  consistencyScore: number;
  specializationScore: number;
  liquidityScore: number;
  totalScore: number;
}

const WEIGHTS = {
  pnl: 0.30,
  timing: 0.25,
  consistency: 0.20,
  specialization: 0.15,
  liquidity: 0.10,
} as const;

function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Map an unbounded value into 0..100 via a soft saturation curve.
 * Useful for "more is better" raw stats where the top end is unknown.
 */
function saturate(value: number, k: number): number {
  if (value <= 0) return 0;
  return clamp(100 * (1 - Math.exp(-value / k)));
}

export class WalletScoring {
  /**
   * Compute a smart-money score for a wallet from its persisted state and trades.
   *
   * smartScore =
   *   pnlScore * 0.30 +
   *   timingScore * 0.25 +
   *   consistencyScore * 0.20 +
   *   specializationScore * 0.15 +
   *   liquidityScore * 0.10
   *
   * These sub-scores are intentionally simple placeholders — replace with
   * proper backtested signals once trade history is rich enough.
   */
  compute(wallet: Wallet, trades: WalletTrade[]): ScoreBreakdown {
    // --- PnL: realizedPnl scaled against volume. ---
    // TODO: replace with risk-adjusted PnL (sharpe-like) when fills are reliable.
    const pnlRatio =
      wallet.totalVolume > 0
        ? wallet.realizedPnl / Math.max(wallet.totalVolume, 1)
        : 0;
    const pnlScore = clamp(50 + pnlRatio * 100);

    // --- Timing: average entry price vs final 0/1 resolution proxy. ---
    // We approximate with "average BUY price < 0.5 => good entry on YES side".
    // TODO: when closed positions are ingested, score entries vs resolution price.
    const buys = trades.filter((t) => t.side === "BUY");
    const avgBuyPrice =
      buys.length > 0
        ? buys.reduce((acc, t) => acc + t.price, 0) / buys.length
        : 0.5;
    const timingScore = clamp((1 - Math.abs(avgBuyPrice - 0.5) * 2) * 50 + 25);

    // --- Consistency: winRate already in [0,1] (defaults to 0). ---
    const consistencyScore = clamp(wallet.winRate * 100);

    // --- Specialization: concentration on the most-traded market. ---
    const marketCounts = new Map<string, number>();
    for (const t of trades) {
      if (!t.marketId) continue;
      marketCounts.set(t.marketId, (marketCounts.get(t.marketId) ?? 0) + 1);
    }
    let specializationScore = 0;
    if (trades.length > 0 && marketCounts.size > 0) {
      const top = Math.max(...marketCounts.values());
      specializationScore = clamp((top / trades.length) * 100);
    }

    // --- Liquidity: how much absolute volume this wallet pushes through. ---
    const liquidityScore = saturate(wallet.totalVolume, 100_000);

    const totalScore = clamp(
      pnlScore * WEIGHTS.pnl +
        timingScore * WEIGHTS.timing +
        consistencyScore * WEIGHTS.consistency +
        specializationScore * WEIGHTS.specialization +
        liquidityScore * WEIGHTS.liquidity,
    );

    return {
      pnlScore,
      timingScore,
      consistencyScore,
      specializationScore,
      liquidityScore,
      totalScore,
    };
  }

  async scoreWallet(address: string): Promise<WalletScore | null> {
    const wallet = await prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
    });
    if (!wallet) return null;

    const trades = await prisma.walletTrade.findMany({
      where: { walletAddress: wallet.address },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    const breakdown = this.compute(wallet, trades);

    const [score] = await prisma.$transaction([
      prisma.walletScore.create({
        data: {
          walletAddress: wallet.address,
          ...breakdown,
        },
      }),
      prisma.wallet.update({
        where: { address: wallet.address },
        data: { smartScore: breakdown.totalScore },
      }),
    ]);

    return score;
  }

  /**
   * Score all wallets we've seen recently. Returns the count scored.
   */
  async scoreAll(limit = 500): Promise<number> {
    const wallets = await prisma.wallet.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });

    let scored = 0;
    for (const w of wallets) {
      try {
        await this.scoreWallet(w.address);
        scored += 1;
      } catch (err) {
        logger.error(
          { err, address: w.address },
          "WalletScoring.scoreAll: failed for wallet",
        );
      }
    }
    logger.info({ scored, total: wallets.length }, "WalletScoring.scoreAll complete");
    return scored;
  }
}

export const walletScoring = new WalletScoring();
