import { Market, Wallet, WalletTrade } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { telegramClient } from "./telegram.client";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatAlert(wallet: Wallet, market: Market, trade: WalletTrade): string {
  const score = wallet.smartScore.toFixed(1);
  return [
    `*🧠 Smart wallet entered a new market*`,
    `Wallet: \`${shortAddress(wallet.address)}\` (score ${score})`,
    `Market: ${market.question}`,
    `Side: ${trade.side}   Price: ${trade.price}   Size: ${trade.size}`,
    market.slug ? `https://polymarket.com/market/${market.slug}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class AlertService {
  /**
   * Send a Telegram alert about a smart wallet entering a new market.
   * Uses AlertLog (walletAddress, marketId) unique constraint to prevent dupes.
   */
  async maybeSendNewMarketAlert(params: {
    wallet: Wallet;
    market: Market;
    trade: WalletTrade;
    threshold?: number;
  }): Promise<boolean> {
    const { wallet, market, trade } = params;
    const threshold = params.threshold ?? env.SMART_WALLET_SCORE_THRESHOLD;

    if (wallet.smartScore < threshold) return false;

    const existing = await prisma.alertLog.findUnique({
      where: {
        walletAddress_marketId: {
          walletAddress: wallet.address,
          marketId: market.id,
        },
      },
    });
    if (existing) return false;

    const message = formatAlert(wallet, market, trade);
    const ok = await telegramClient.sendMessage(message);

    try {
      await prisma.alertLog.create({
        data: {
          walletAddress: wallet.address,
          marketId: market.id,
          message,
        },
      });
    } catch (err) {
      logger.warn(
        { err, address: wallet.address, marketId: market.id },
        "AlertService: failed to persist AlertLog (likely race) — alert may duplicate",
      );
    }

    return ok;
  }
}

export const alertService = new AlertService();
