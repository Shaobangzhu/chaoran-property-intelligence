import { describe, expect, it } from "vitest";

import config from "../../allurerc.mjs";

describe("Allure report configuration", () => {
  it("persists a bounded Allure 3 launch history outside generated reports", () => {
    expect(config).toMatchObject({
      historyLimit: 30,
      historyPath: "./allure-history/history.jsonl",
      plugins: {
        awesome: {
          options: {
            singleFile: true,
          },
        },
      },
    });
  });
});
