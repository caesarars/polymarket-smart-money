import axios, { AxiosInstance } from "axios";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

export interface SendMessageOptions {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disablePreview?: boolean;
}

export class TelegramClient {
  private readonly http: AxiosInstance | null;
  private readonly chatId: string | null;
  private readonly enabled: boolean;

  constructor(
    botToken: string | undefined = env.TELEGRAM_BOT_TOKEN,
    chatId: string | undefined = env.TELEGRAM_CHAT_ID,
  ) {
    this.enabled = Boolean(botToken && chatId);
    this.chatId = chatId ?? null;
    this.http = this.enabled
      ? axios.create({
          baseURL: `https://api.telegram.org/bot${botToken}`,
          timeout: 10_000,
        })
      : null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendMessage(text: string, opts: SendMessageOptions = {}): Promise<boolean> {
    if (!this.enabled || !this.http || !this.chatId) {
      logger.warn(
        { textPreview: text.slice(0, 80) },
        "TelegramClient: skipped — bot not configured",
      );
      return false;
    }

    try {
      await this.http.post("/sendMessage", {
        chat_id: this.chatId,
        text,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_web_page_preview: opts.disablePreview ?? true,
      });
      return true;
    } catch (err) {
      logger.error({ err }, "TelegramClient.sendMessage failed");
      return false;
    }
  }
}

export const telegramClient = new TelegramClient();
