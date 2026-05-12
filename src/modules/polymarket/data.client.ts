import axios, { AxiosInstance } from "axios";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import {
  DataActivity,
  DataHolder,
  DataPosition,
  DataTrade,
} from "./polymarket.types";

export interface GetTradesParams {
  market?: string;
  user?: string;
  side?: "BUY" | "SELL";
  limit?: number;
  offset?: number;
  takerOnly?: boolean;
}

export class DataClient {
  private readonly http: AxiosInstance;

  constructor(baseURL: string = env.POLYMARKET_DATA_API_URL) {
    this.http = axios.create({
      baseURL,
      timeout: 15_000,
      headers: { Accept: "application/json" },
    });
  }

  async getTrades(params: GetTradesParams = {}): Promise<DataTrade[]> {
    const query = {
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
      ...(params.market ? { market: params.market } : {}),
      ...(params.user ? { user: params.user } : {}),
      ...(params.side ? { side: params.side } : {}),
      ...(typeof params.takerOnly === "boolean"
        ? { takerOnly: params.takerOnly }
        : {}),
    };

    try {
      const { data } = await this.http.get<DataTrade[]>("/trades", {
        params: query,
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, query }, "DataClient.getTrades failed");
      return [];
    }
  }

  async getActivityByWallet(
    address: string,
    limit = 100,
  ): Promise<DataActivity[]> {
    try {
      // TODO: confirm exact path — data-api exposes /activity?user=<addr>
      const { data } = await this.http.get<DataActivity[]>("/activity", {
        params: { user: address, limit },
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, address }, "DataClient.getActivityByWallet failed");
      return [];
    }
  }

  async getPositionsByWallet(address: string): Promise<DataPosition[]> {
    try {
      const { data } = await this.http.get<DataPosition[]>("/positions", {
        params: { user: address },
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, address }, "DataClient.getPositionsByWallet failed");
      return [];
    }
  }

  async getClosedPositionsByWallet(
    address: string,
  ): Promise<DataPosition[]> {
    try {
      // TODO: confirm path — closed positions may be /positions?closedOnly=true
      const { data } = await this.http.get<DataPosition[]>("/positions", {
        params: { user: address, closedOnly: true },
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error(
        { err, address },
        "DataClient.getClosedPositionsByWallet failed",
      );
      return [];
    }
  }

  async getHolders(marketId: string): Promise<DataHolder[]> {
    try {
      // TODO: confirm path — Polymarket exposes /holders?market=<conditionId>
      const { data } = await this.http.get<DataHolder[]>("/holders", {
        params: { market: marketId },
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, marketId }, "DataClient.getHolders failed");
      return [];
    }
  }
}

export const dataClient = new DataClient();
