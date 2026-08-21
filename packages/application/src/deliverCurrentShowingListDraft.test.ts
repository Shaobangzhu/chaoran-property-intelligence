import { describe, expect, it, vi } from "vitest";

import type {
  CurrentShowingListDraft,
  CurrentShowingListDraftDeliveryRepositoryPort,
} from "./currentShowingListDraftRepository.js";
import {
  DeliverCurrentShowingListDraft,
  ShowingListDeliveryFailedError,
  type ShowingListDownloadLinkPort,
  type ShowingListDraftNotificationPort,
} from "./deliverCurrentShowingListDraft.js";

const generationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const listingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-08-24T15:00:00.000Z");

describe("DeliverCurrentShowingListDraft", () => {
  it("creates one transient link, sends it, and records delivery", async () => {
    const current = createCurrentDraft();
    const deliveredAt = "2026-08-24T15:00:00.001Z";
    const repository = createRepository(current, {
      ...current,
      deliveryStatus: "sent",
      deliveredAt,
      updatedAt: deliveredAt,
    });
    const downloadLinks = createDownloadLinks();
    const notifications = createNotifications();
    const useCase = createUseCase(repository, downloadLinks, notifications);

    await expect(
      useCase.execute({ generationId }),
    ).resolves.toMatchObject({ outcome: "sent" });
    expect(downloadLinks.createCurrentDownloadLink).toHaveBeenCalledWith({
      expiresInSeconds: 900,
    });
    expect(notifications.sendCurrentShowingListDraft).toHaveBeenCalledWith({
      downloadUrl: "https://artifacts.example/current.pdf?signed=secret",
      expiresAt: "2026-08-24T15:15:00.000Z",
    });
    expect(repository.markCurrentDraftDeliverySent).toHaveBeenCalledWith({
      generationId,
      expectedUpdatedAt: current.updatedAt,
      deliveredAt,
    });
    expect(repository.markCurrentDraftDeliveryFailed).not.toHaveBeenCalled();
  });

  it("suppresses an ordinary retry after a confirmed send", async () => {
    const current = createCurrentDraft({
      deliveryStatus: "sent",
      deliveredAt: "2026-08-24T14:55:00.000Z",
      updatedAt: "2026-08-24T14:55:00.000Z",
    });
    const repository = createRepository(current, current);
    const downloadLinks = createDownloadLinks();
    const notifications = createNotifications();

    await expect(
      createUseCase(repository, downloadLinks, notifications).execute({
        generationId,
      }),
    ).resolves.toMatchObject({ outcome: "already-sent" });
    expect(downloadLinks.createCurrentDownloadLink).not.toHaveBeenCalled();
    expect(notifications.sendCurrentShowingListDraft).not.toHaveBeenCalled();
    expect(repository.markCurrentDraftDeliverySent).not.toHaveBeenCalled();
  });

  it("records failure without rolling back the published current draft", async () => {
    const current = createCurrentDraft();
    const repository = createRepository(current, null);
    const notifications = createNotifications(
      new Error("provider response contained a private URL"),
    );
    const useCase = createUseCase(
      repository,
      createDownloadLinks(),
      notifications,
    );

    const error = await useCase
      .execute({ generationId })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ShowingListDeliveryFailedError);
    expect((error as Error).message).not.toContain("https://");
    expect(repository.markCurrentDraftDeliveryFailed).toHaveBeenCalledWith({
      generationId,
      expectedUpdatedAt: current.updatedAt,
      updatedAt: "2026-08-24T15:00:00.001Z",
    });
    expect(notifications.sendCurrentShowingListDraft).toHaveBeenCalledTimes(2);
    expect(repository.markCurrentDraftDeliverySent).not.toHaveBeenCalled();
  });

  it("rejects an invalid transient URL before Telegram", async () => {
    const current = createCurrentDraft();
    const repository = createRepository(current, null);
    const downloadLinks: ShowingListDownloadLinkPort = {
      createCurrentDownloadLink: vi.fn(async () => ({
        url: "http://public.example/current.pdf",
        expiresAt: "2026-08-24T15:15:00.000Z",
      })),
    };
    const notifications = createNotifications();

    await expect(
      createUseCase(repository, downloadLinks, notifications).execute({
        generationId,
      }),
    ).rejects.toBeInstanceOf(ShowingListDeliveryFailedError);
    expect(notifications.sendCurrentShowingListDraft).not.toHaveBeenCalled();
    expect(repository.markCurrentDraftDeliveryFailed).toHaveBeenCalledOnce();
    expect(downloadLinks.createCurrentDownloadLink).toHaveBeenCalledTimes(2);
  });
});

function createUseCase(
  repository: CurrentShowingListDraftDeliveryRepositoryPort,
  downloadLinks: ShowingListDownloadLinkPort,
  notifications: ShowingListDraftNotificationPort,
) {
  return new DeliverCurrentShowingListDraft({
    repository,
    downloadLinks,
    notifications,
    expiresInSeconds: 900,
    now: () => now,
  });
}

function createRepository(
  current: CurrentShowingListDraft,
  sent: CurrentShowingListDraft | null,
): CurrentShowingListDraftDeliveryRepositoryPort & {
  markCurrentDraftDeliveryFailed: ReturnType<typeof vi.fn>;
  markCurrentDraftDeliverySent: ReturnType<typeof vi.fn>;
} {
  return {
    findCurrentDraft: vi.fn(async () => current),
    markCurrentDraftDeliveryFailed: vi.fn(async () => ({
      ...current,
      deliveryStatus: "failed" as const,
      deliveredAt: null,
      updatedAt: "2026-08-24T15:00:00.001Z",
    })),
    markCurrentDraftDeliverySent: vi.fn(async () => sent),
  };
}

function createDownloadLinks(): ShowingListDownloadLinkPort & {
  createCurrentDownloadLink: ReturnType<typeof vi.fn>;
} {
  return {
    createCurrentDownloadLink: vi.fn(async () => ({
      url: "https://artifacts.example/current.pdf?signed=secret",
      expiresAt: "2026-08-24T15:15:00.000Z",
    })),
  };
}

function createNotifications(
  outcome?: Error,
): ShowingListDraftNotificationPort & {
  sendCurrentShowingListDraft: ReturnType<typeof vi.fn>;
} {
  return {
    sendCurrentShowingListDraft: vi.fn(async () => {
      if (outcome !== undefined) {
        throw outcome;
      }
    }),
  };
}

function createCurrentDraft(
  overrides: Partial<CurrentShowingListDraft> = {},
): CurrentShowingListDraft {
  return {
    generationId,
    createdByUserId: actorUserId,
    promptVersion: "v1",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: null,
        showingDate: null,
        agentInstructions: null,
      },
    },
    draft: {
      title: "Weekly Showing List",
      summary: "Unreviewed draft.",
      stops: [
        {
          listingId,
          proposedOrder: 1,
          orderReason: "Review the proposed order.",
          highlights: [],
          considerations: [],
        },
      ],
      clientMessage: "Review before use.",
      reviewWarnings: ["Licensed-agent review is required."],
    },
    generationMetadata: {
      model: "gpt-5.6-terra",
      responseId: "resp_123",
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      durationMs: 100,
    },
    artifact: {
      key: "showing-lists/current.pdf",
      etag: '"etag"',
    },
    status: "draft",
    deliveryStatus: "pending",
    deliveredAt: null,
    generatedAt: "2026-08-24T14:50:00.000Z",
    updatedAt: "2026-08-24T15:00:00.000Z",
    ...overrides,
  };
}
