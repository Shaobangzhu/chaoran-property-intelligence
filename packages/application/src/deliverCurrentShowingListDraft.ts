import { z } from "zod";

import {
  safeParseCurrentShowingListDraft,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftDeliveryRepositoryPort,
} from "./currentShowingListDraftRepository.js";

export const SHOWING_LIST_DOWNLOAD_LINK_LIMITS = Object.freeze({
  minimumExpiresInSeconds: 60,
  maximumExpiresInSeconds: 15 * 60,
  maximumUrlLength: 8_192,
  maximumDeliveryAttempts: 3,
});

const deliveryInputSchema = z.strictObject({
  generationId: z.uuid(),
});
const downloadLinkSchema = z.strictObject({
  url: z
    .url()
    .max(SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumUrlLength)
    .refine((value) => /^https:\/\//iu.test(value)),
  expiresAt: z.iso.datetime({ offset: true }),
});

export interface ShowingListDownloadLink {
  url: string;
  expiresAt: string;
}

export interface ShowingListDownloadLinkPort {
  createCurrentDownloadLink(input: {
    expiresInSeconds: number;
  }): Promise<ShowingListDownloadLink>;
}

export interface ShowingListDraftNotification {
  downloadUrl: string;
  expiresAt: string;
}

export interface ShowingListDraftNotificationPort {
  sendCurrentShowingListDraft(
    input: ShowingListDraftNotification,
  ): Promise<void>;
}

export interface DeliverCurrentShowingListDraftInput {
  generationId: string;
}

export interface DeliverCurrentShowingListDraftOptions {
  repository: CurrentShowingListDraftDeliveryRepositoryPort;
  downloadLinks: ShowingListDownloadLinkPort;
  notifications: ShowingListDraftNotificationPort;
  expiresInSeconds: number;
  maximumAttempts?: number;
  now?: () => Date;
}

export interface DeliverCurrentShowingListDraftResult {
  outcome: "sent" | "already-sent";
  current: CurrentShowingListDraft;
}

export class InvalidShowingListDeliveryInputError extends Error {
  constructor() {
    super("Showing List delivery input was invalid");
    this.name = "InvalidShowingListDeliveryInputError";
  }
}

export class ShowingListDeliveryStateConflictError extends Error {
  constructor() {
    super("Current Showing List delivery state changed");
    this.name = "ShowingListDeliveryStateConflictError";
  }
}

export class ShowingListDeliveryFailedError extends Error {
  constructor() {
    super("Current Showing List delivery failed");
    this.name = "ShowingListDeliveryFailedError";
  }
}

export class DeliverCurrentShowingListDraft {
  private readonly expiresInSeconds: number;
  private readonly maximumAttempts: number;
  private readonly now: () => Date;

  constructor(private readonly options: DeliverCurrentShowingListDraftOptions) {
    if (
      !Number.isInteger(options.expiresInSeconds) ||
      options.expiresInSeconds <
        SHOWING_LIST_DOWNLOAD_LINK_LIMITS.minimumExpiresInSeconds ||
      options.expiresInSeconds >
        SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumExpiresInSeconds
    ) {
      throw new RangeError("Showing List download link expiry was invalid");
    }

    this.expiresInSeconds = options.expiresInSeconds;
    this.maximumAttempts = options.maximumAttempts ?? 2;
    if (
      !Number.isInteger(this.maximumAttempts) ||
      this.maximumAttempts < 1 ||
      this.maximumAttempts >
        SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumDeliveryAttempts
    ) {
      throw new RangeError("Showing List delivery attempts were invalid");
    }
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    input: DeliverCurrentShowingListDraftInput,
  ): Promise<DeliverCurrentShowingListDraftResult> {
    const parsedInput = deliveryInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new InvalidShowingListDeliveryInputError();
    }

    const current = await this.options.repository.findCurrentDraft();
    if (
      current === null ||
      current.generationId !== parsedInput.data.generationId
    ) {
      throw new ShowingListDeliveryStateConflictError();
    }
    if (current.deliveryStatus === "sent") {
      return { outcome: "already-sent", current };
    }

    const deliverySucceeded = await this.attemptDelivery();
    if (!deliverySucceeded) {
      await this.recordFailedAttempt(current);
      throw new ShowingListDeliveryFailedError();
    }

    const deliveredAt = nextTimestamp(current.updatedAt, this.now());
    const persistedDelivery =
      await this.options.repository.markCurrentDraftDeliverySent({
        generationId: current.generationId,
        expectedUpdatedAt: current.updatedAt,
        deliveredAt,
      });
    if (persistedDelivery === null) {
      throw new ShowingListDeliveryStateConflictError();
    }

    const parsedDelivered = safeParseCurrentShowingListDraft(persistedDelivery);
    if (
      !parsedDelivered.success ||
      parsedDelivered.data.deliveryStatus !== "sent" ||
      parsedDelivered.data.deliveredAt !== deliveredAt
    ) {
      throw new ShowingListDeliveryStateConflictError();
    }

    return { outcome: "sent", current: parsedDelivered.data };
  }

  private async attemptDelivery(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        const link =
          await this.options.downloadLinks.createCurrentDownloadLink({
            expiresInSeconds: this.expiresInSeconds,
          });
        const parsedLink = downloadLinkSchema.safeParse(link);
        if (
          !parsedLink.success ||
          !isValidExpiry(
            parsedLink.data,
            this.now(),
            this.expiresInSeconds,
          )
        ) {
          throw new Error("Invalid transient download link");
        }
        await this.options.notifications.sendCurrentShowingListDraft({
          downloadUrl: parsedLink.data.url,
          expiresAt: parsedLink.data.expiresAt,
        });
        return true;
      } catch {
        // A timeout has unknown delivery outcome; the bounded retry can duplicate it.
      }
    }
    return false;
  }

  private async recordFailedAttempt(
    current: CurrentShowingListDraft,
  ): Promise<void> {
    try {
      await this.options.repository.markCurrentDraftDeliveryFailed({
        generationId: current.generationId,
        expectedUpdatedAt: current.updatedAt,
        updatedAt: nextTimestamp(current.updatedAt, this.now()),
      });
    } catch {
      // The delivery error remains primary and contains no transient URL.
    }
  }
}

function isValidExpiry(
  link: ShowingListDownloadLink,
  now: Date,
  maximumExpiresInSeconds: number,
): boolean {
  const expiresAt = Date.parse(link.expiresAt);
  const nowMs = now.getTime();
  return (
    Number.isFinite(nowMs) &&
    expiresAt > nowMs &&
    expiresAt <= nowMs + maximumExpiresInSeconds * 1_000
  );
}

function nextTimestamp(previousTimestamp: string, now: Date): string {
  const previous = Date.parse(previousTimestamp);
  const current = now.getTime();
  const timestamp = Math.max(current, previous + 1);
  return new Date(timestamp).toISOString();
}
