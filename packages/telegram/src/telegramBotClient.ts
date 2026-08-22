import {
  safeParseListingAlertEvent,
  type ListingAlertEvent,
  type ListingAlertNotificationPort,
} from "@chaoran-property-intelligence/application";

const telegramApiBaseUrl = "https://api.telegram.org";
const telegramMessageTextLimit = 4096;
const productionSmokeTestText = [
  "CPI production smoke test",
  "Telegram delivery is working.",
  "No listing data was used.",
].join("\n");

export interface TelegramNotificationPort {
  sendListingAddresses(addresses: string[]): Promise<void>;
}

export interface ShowingListDraftNotification {
  downloadUrl: string;
  expiresAt: string;
}

export interface TelegramBotClientOptions {
  botToken: string;
  chatId: string;
  fetch: typeof fetch;
}

export class TelegramBotClient
  implements TelegramNotificationPort, ListingAlertNotificationPort
{
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetch: typeof fetch;

  constructor(options: TelegramBotClientOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetch = options.fetch;
  }

  async sendListingAddresses(addresses: string[]): Promise<void> {
    if (addresses.length === 0) {
      return;
    }

    const messageChunks = chunkAddresses(addresses);
    for (const text of messageChunks) {
      await this.sendMessage(text);
    }
  }

  async sendListingAlerts(
    events: readonly ListingAlertEvent[],
  ): Promise<void> {
    const messageChunks = chunkListingAlertEvents(events);
    for (const text of messageChunks) {
      await this.sendMessage(text);
    }
  }

  async sendProductionSmokeTest(): Promise<void> {
    await this.sendMessage(productionSmokeTestText);
  }

  async sendCurrentShowingListDraft(
    notification: ShowingListDraftNotification,
  ): Promise<void> {
    if (!isValidShowingListDraftNotification(notification)) {
      throw new Error("Showing List Telegram notification was invalid");
    }

    await this.sendMessage(
      [
        "CPI weekly Showing List draft is ready.",
        "UNREVIEWED DRAFT - licensed-agent review is required before use.",
        `Download PDF: ${notification.downloadUrl}`,
        `This private link expires at ${notification.expiresAt}.`,
      ].join("\n"),
    );
  }

  private async sendMessage(text: string): Promise<void> {
    const url = new URL(`/bot${this.botToken}/sendMessage`, telegramApiBaseUrl);
    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Telegram sendMessage request failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as unknown;
    if (!isTelegramOkResponse(body)) {
      throw new Error("Telegram sendMessage API returned ok=false");
    }
  }
}

function chunkAddresses(addresses: string[]): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  for (const address of addresses) {
    if (address.length > telegramMessageTextLimit) {
      throw new Error("Telegram message text cannot exceed 4096 characters");
    }

    const nextChunk =
      currentChunk.length === 0 ? address : `${currentChunk}\n${address}`;

    if (nextChunk.length <= telegramMessageTextLimit) {
      currentChunk = nextChunk;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = address;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function formatListingAlertEvent(event: ListingAlertEvent): string {
  const parsedEvent = parsePendingListingAlertEvent(event);

  if (parsedEvent.kind === "new-listing") {
    return [
      "NEW LISTING",
      "",
      parsedEvent.formattedAddress,
      formatCurrency(parsedEvent.currentPrice),
    ].join("\n");
  }

  const decrease = parsedEvent.previousPrice - parsedEvent.currentPrice;
  const percentage = (decrease / parsedEvent.previousPrice) * 100;

  return [
    "PRICE DROP",
    "",
    parsedEvent.formattedAddress,
    `${formatCurrency(parsedEvent.previousPrice)} -> ${formatCurrency(parsedEvent.currentPrice)}`,
    `Down ${formatCurrency(decrease)} (${percentage.toFixed(1)}%)`,
  ].join("\n");
}

function chunkListingAlertEvents(
  events: readonly ListingAlertEvent[],
): string[] {
  const blocks = events.map(formatListingAlertEvent);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const block of blocks) {
    if (block.length > telegramMessageTextLimit) {
      throw new Error("Telegram listing alert cannot exceed 4096 characters");
    }

    const nextChunk =
      currentChunk.length === 0 ? block : `${currentChunk}\n\n${block}`;
    if (nextChunk.length <= telegramMessageTextLimit) {
      currentChunk = nextChunk;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = block;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function parsePendingListingAlertEvent(
  event: ListingAlertEvent,
): ListingAlertEvent {
  const result = safeParseListingAlertEvent(event);
  if (!result.success || result.data.status !== "pending") {
    throw new Error("Telegram listing alert event was invalid");
  }
  return result.data;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  })}`;
}

function isTelegramOkResponse(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true
  );
}

function isValidShowingListDraftNotification(
  value: ShowingListDraftNotification,
): boolean {
  if (
    typeof value.downloadUrl !== "string" ||
    value.downloadUrl.length > 8_192
  ) {
    return false;
  }

  try {
    const url = new URL(value.downloadUrl);
    return (
      url.protocol === "https:" &&
      url.hash.length === 0 &&
      Number.isFinite(Date.parse(value.expiresAt))
    );
  } catch {
    return false;
  }
}
