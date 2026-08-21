import { describe, expect, it, vi } from "vitest";

import { TelegramBotClient } from "./telegramBotClient.js";

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
