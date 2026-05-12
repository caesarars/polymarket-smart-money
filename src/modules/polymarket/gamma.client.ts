import axios, { AxiosInstance } from "axios";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { GammaEvent, GammaMarket } from "./polymarket.types";

export interface GetMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  category?: string;
  order?: string;
  ascending?: boolean;
}

export class GammaClient {
  private readonly http: AxiosInstance;

  constructor(baseURL: string = env.POLYMARKET_GAMMA_API_URL) {
    this.http = axios.create({
      baseURL,
      timeout: 15_000,
      headers: { Accept: "application/json" },
    });
  }

  async getMarkets(params: GetMarketsParams = {}): Promise<GammaMarket[]> {
    const query = {
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
      active: params.active ?? true,
      closed: params.closed ?? false,
      ...(params.category ? { category: params.category } : {}),
      ...(params.order ? { order: params.order } : {}),
      ...(typeof params.ascending === "boolean"
        ? { ascending: params.ascending }
        : {}),
    };

    try {
      const { data } = await this.http.get<GammaMarket[]>("/markets", {
        params: query,
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, query }, "GammaClient.getMarkets failed");
      return [];
    }
  }

  async getEvents(params: GetMarketsParams = {}): Promise<GammaEvent[]> {
    const query = {
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
      active: params.active ?? true,
      closed: params.closed ?? false,
      ...(params.category ? { category: params.category } : {}),
    };

    try {
      const { data } = await this.http.get<GammaEvent[]>("/events", {
        params: query,
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, query }, "GammaClient.getEvents failed");
      return [];
    }
  }

  async searchMarkets(query: string, limit = 25): Promise<GammaMarket[]> {
    try {
      // TODO: confirm exact search parameter — gamma exposes `q` for free-text.
      const { data } = await this.http.get<GammaMarket[]>("/markets", {
        params: { q: query, limit, active: true, closed: false },
      });
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({ err, query }, "GammaClient.searchMarkets failed");
      return [];
    }
  }
}

export const gammaClient = new GammaClient();
