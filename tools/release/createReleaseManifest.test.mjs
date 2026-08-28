import { describe, expect, it } from "vitest";

import { createReleaseManifest } from "./createReleaseManifest.mjs";

describe("createReleaseManifest", () => {
  it("creates a bounded immutable release identity", () => {
    expect(
      createReleaseManifest({ gitSha: "a".repeat(40), stage: "dev" }),
    ).toEqual({ gitSha: "a".repeat(40), stage: "dev" });
  });

  it.each(["main", "development", "prod"])(
    "rejects unsupported stage %s",
    (stage) => {
      expect(() =>
        createReleaseManifest({ gitSha: "a".repeat(40), stage }),
      ).toThrow("stage must be dev or production");
    },
  );

  it.each(["", "A".repeat(40), "a".repeat(39), "not-a-sha"])(
    "rejects invalid SHA %s",
    (gitSha) => {
      expect(() => createReleaseManifest({ gitSha, stage: "dev" })).toThrow(
        "gitSha must be a lowercase 40-character Git SHA",
      );
    },
  );
});
