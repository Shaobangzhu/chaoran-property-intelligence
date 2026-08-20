import { describe, expect, it } from "vitest";

import {
  InvalidUserEmailError,
  isUserRole,
  isUserStatus,
  normalizeUserEmail,
} from "./user.js";

describe("normalizeUserEmail", () => {
  it("trims and lowercases an email address", () => {
    expect(normalizeUserEmail("  Admin@Example.COM  ")).toBe(
      "admin@example.com",
    );
  });

  it.each([
    "",
    "not-an-email",
    "admin @example.com",
    "admin@example",
    `${"a".repeat(243)}@example.com`,
  ])("rejects an invalid or unbounded email: %s", (email) => {
    expect(() => normalizeUserEmail(email)).toThrow(InvalidUserEmailError);
  });
});

describe("user role and status", () => {
  it("accepts only the supported administrator role", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("viewer")).toBe(false);
  });

  it("accepts only active and disabled statuses", () => {
    expect(isUserStatus("active")).toBe(true);
    expect(isUserStatus("disabled")).toBe(true);
    expect(isUserStatus("deleted")).toBe(false);
  });
});
