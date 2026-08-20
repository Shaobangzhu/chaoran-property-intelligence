import { describe, expect, it, vi } from "vitest";

import { runTelegramSmokeTest } from "./runTelegramSmokeTest.js";

describe("runTelegramSmokeTest", () => {
  it("uses only Telegram configuration and sends exactly one fixed message", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} }),
    );

    await runTelegramSmokeTest({
      environment: {
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "123456",
      },
      fetch,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).pathname).toBe("/bottest-token/sendMessage");
    expect(JSON.parse(init?.body as string)).toEqual({
      chat_id: "123456",
      text: [
        "CPI production smoke test",
        "Telegram delivery is working.",
        "No listing data was used.",
      ].join("\n"),
    });
  });
});
