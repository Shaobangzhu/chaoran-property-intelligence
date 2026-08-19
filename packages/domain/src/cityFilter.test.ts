import { describe, expect, it } from "vitest";

import { isTargetCity } from "./cityFilter.js";

describe("target city filtering", () => {
  it("accepts the five MVP target cities", () => {
    expect(isTargetCity("Chino")).toBe(true);
    expect(isTargetCity("Chino Hills")).toBe(true);
    expect(isTargetCity("Eastvale")).toBe(true);
    expect(isTargetCity("Corona")).toBe(true);
    expect(isTargetCity("Jurupa Valley")).toBe(true);
  });

  it("rejects the search center city because radius alone is not enough", () => {
    expect(isTargetCity("Brea")).toBe(false);
  });

  it("rejects non-target cities even if they are in nearby counties", () => {
    expect(isTargetCity("Riverside")).toBe(false);
  });
});
