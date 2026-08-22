import { describe, expect, it, vi } from "vitest";

import type { ListingAlertEvent } from "@chaoran-property-intelligence/application";

import {
  formatListingAlertEvent,
  TelegramBotClient,
} from "./telegramBotClient.js";

describe("TelegramBotClient", () => {
  function createClient(fetch: typeof globalThis.fetch): TelegramBotClient {
    return new TelegramBotClient({
      botToken: "test-token",
      chatId: "123456",
      fetch,
    });
  }

  function expectTelegramRequest(
    fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
    callIndex: number,
  ): { url: URL; body: Record<string, unknown> } {
    const call = fetch.mock.calls[callIndex];
    expect(call).toBeDefined();
    if (call === undefined) {
      throw new Error(`Expected Telegram fetch call ${callIndex}`);
    }

    const [url, init] = call;
    expect(url).toBeInstanceOf(URL);
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const body = JSON.parse(init?.body as string) as Record<string, unknown>;

    return {
      url: url as URL,
      body,
    };
  }

  it("does not call Telegram when there are no addresses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendListingAddresses([]);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call Telegram when there are no listing alert events", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendListingAlerts([]);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("formats new-listing and price-drop events as complete readable blocks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendListingAlerts([
      createNewListingEvent(),
      createPriceDropEvent(),
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    const { body } = expectTelegramRequest(fetch, 0);
    expect(body).toEqual({
      chat_id: "123456",
      text: [
        "NEW LISTING",
        "",
        "100 Main St, Chino, CA 91710",
        "$825,000",
        "",
        "PRICE DROP",
        "",
        "3420 New York Dr, Corona, CA 92882",
        "$849,900 -> $829,900",
        "Down $20,000 (2.4%)",
      ].join("\n"),
    });
  });

  it("formats a one-dollar decrease with consistent percentage rounding", () => {
    expect(
      formatListingAlertEvent(
        createPriceDropEvent({
          previousPrice: 825000,
          currentPrice: 824999,
        }),
      ),
    ).toContain("Down $1 (0.0%)");
  });

  it("chunks listing alerts without splitting an event block", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);
    const events = Array.from({ length: 10 }, (_, index) =>
      createNewListingEvent({
        eventKey: `listing-alert:v1:new-listing:${index}`,
        formattedAddress: `${index} ${"A".repeat(470)}, Chino, CA 91710`,
      }),
    );

    await client.sendListingAlerts(events);

    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    const texts = fetch.mock.calls.map((_, index) =>
      String(expectTelegramRequest(fetch, index).body["text"]),
    );
    expect(texts.every((text) => text.length <= 4096)).toBe(true);
    expect(texts.join("\n\n").match(/NEW LISTING/g)).toHaveLength(
      events.length,
    );
    for (const event of events) {
      expect(texts.some((text) => text.includes(event.formattedAddress))).toBe(
        true,
      );
    }
  });

  it("validates the full listing-alert batch before sending", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendListingAlerts([
        createNewListingEvent(),
        { ...createPriceDropEvent(), status: "sent" },
      ]),
    ).rejects.toThrow("Telegram listing alert event was invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates a Telegram failure from listing-alert delivery", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("Bad Gateway", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendListingAlerts([createPriceDropEvent()]),
    ).rejects.toThrow("Telegram sendMessage request failed with status 502");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sends a fixed production smoke-test message without listing data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendProductionSmokeTest();

    expect(fetch).toHaveBeenCalledOnce();
    const { body } = expectTelegramRequest(fetch, 0);
    expect(body).toEqual({
      chat_id: "123456",
      text: [
        "CPI production smoke test",
        "Telegram delivery is working.",
        "No listing data was used.",
      ].join("\n"),
    });
  });

  it("sends the private Showing List link with an unreviewed warning", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendCurrentShowingListDraft({
      downloadUrl: "https://signed.example/current.pdf?signature=secret",
      expiresAt: "2026-08-24T15:15:00.000Z",
    });

    const { body } = expectTelegramRequest(fetch, 0);
    expect(body).toEqual({
      chat_id: "123456",
      text: [
        "CPI weekly Showing List draft is ready.",
        "UNREVIEWED DRAFT - licensed-agent review is required before use.",
        "Download PDF: https://signed.example/current.pdf?signature=secret",
        "This private link expires at 2026-08-24T15:15:00.000Z.",
      ].join("\n"),
    });
  });

  it("rejects an insecure Showing List URL before calling Telegram", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendCurrentShowingListDraft({
        downloadUrl: "http://public.example/current.pdf",
        expiresAt: "2026-08-24T15:15:00.000Z",
      }),
    ).rejects.toThrow("Showing List Telegram notification was invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only listing addresses separated by newlines", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await client.sendListingAddresses([
      "123 Main St, Eastvale, CA 92880",
      "456 Oak Ave, Chino, CA 91710",
    ]);

    expect(fetch).toHaveBeenCalledOnce();

    const { url, body } = expectTelegramRequest(fetch, 0);
    expect(url.origin).toBe("https://api.telegram.org");
    expect(url.pathname).toBe("/bottest-token/sendMessage");
    expect(body).toEqual({
      chat_id: "123456",
      text: "123 Main St, Eastvale, CA 92880\n456 Oak Ave, Chino, CA 91710",
    });
  });

  it("splits address messages into chunks below Telegram's text limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);
    const longAddress = `${"1".repeat(4070)}, Eastvale, CA 92880`;

    await client.sendListingAddresses([
      longAddress,
      "456 Oak Ave, Chino, CA 91710",
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);

    const firstRequest = expectTelegramRequest(fetch, 0);
    const secondRequest = expectTelegramRequest(fetch, 1);
    expect((firstRequest.body["text"] as string).length).toBeLessThanOrEqual(
      4096,
    );
    expect((secondRequest.body["text"] as string).length).toBeLessThanOrEqual(
      4096,
    );
    expect(firstRequest.body["text"]).toBe(longAddress);
    expect(secondRequest.body["text"]).toBe("456 Oak Ave, Chino, CA 91710");
  });

  it("throws when a single address exceeds Telegram's text limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendListingAddresses(["1".repeat(4097)]),
    ).rejects.toThrow("Telegram message text cannot exceed 4096 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when Telegram returns a non-2xx response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("Bad Request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendListingAddresses(["123 Main St, Eastvale, CA 92880"]),
    ).rejects.toThrow("Telegram sendMessage request failed with status 400");
  });

  it("throws when Telegram returns ok false", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        ok: false,
        description: "Bad Request: chat not found",
      }),
    );
    const client = createClient(fetch);

    await expect(
      client.sendListingAddresses(["123 Main St, Eastvale, CA 92880"]),
    ).rejects.toThrow("Telegram sendMessage API returned ok=false");
  });
});

function createNewListingEvent(
  overrides: Partial<ListingAlertEvent> = {},
): ListingAlertEvent {
  return {
    eventKey: "listing-alert:v1:new-listing:test",
    listingKey: "mls:CRMLS:CV26000001:2026-08-19T00:00:00.000Z",
    addressKey:
      "address:v1:100%20main%20st||chino|ca|91710" as ListingAlertEvent["addressKey"],
    kind: "new-listing",
    formattedAddress: "100 Main St, Chino, CA 91710",
    previousPrice: null,
    currentPrice: 825000,
    status: "pending",
    observedAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  } as ListingAlertEvent;
}

function createPriceDropEvent(
  overrides: Partial<ListingAlertEvent> = {},
): ListingAlertEvent {
  return {
    eventKey: "listing-alert:v1:price-drop:test",
    listingKey: "mls:CRMLS:PW26181310:2026-08-19T00:00:00.000Z",
    addressKey:
      "address:v1:3420%20new%20york%20dr||corona|ca|92882" as ListingAlertEvent["addressKey"],
    kind: "price-drop",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    previousPrice: 849900,
    currentPrice: 829900,
    status: "pending",
    observedAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  } as ListingAlertEvent;
}
