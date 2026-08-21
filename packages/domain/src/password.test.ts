import { describe, expect, it } from "vitest";

import { normalizeUserEmail } from "./user.js";
import {
  PasswordPolicyError,
  normalizePassword,
  validateNewPassword,
} from "./password.js";

describe("password policy", () => {
  it("normalizes Unicode to NFC and counts Unicode code points", () => {
    const decomposedPassword = "e\u0301".repeat(15);

    expect(validateNewPassword(decomposedPassword)).toBe(
      "é".repeat(15),
    );
  });

  it("preserves spaces and does not impose composition rules", () => {
    expect(validateNewPassword("  all lowercase phrase  ")).toBe(
      "  all lowercase phrase  ",
    );
  });

  it.each(["a".repeat(14), "a".repeat(129)])(
    "rejects a password outside the 15-128 code-point boundary",
    (password) => {
      expect(() => validateNewPassword(password)).toThrow(
        new PasswordPolicyError("length"),
      );
    },
  );

  it("rejects control characters", () => {
    expect(() =>
      validateNewPassword("safe password\nphrase"),
    ).toThrow(new PasswordPolicyError("control-character"));
  });

  it("rejects a complete common blocked password", () => {
    expect(() => validateNewPassword("passwordpassword")).toThrow(
      new PasswordPolicyError("blocked"),
    );
  });

  it("rejects the complete normalized email as context-specific input", () => {
    expect(() =>
      validateNewPassword("admin@example.com", {
        normalizedEmail: normalizeUserEmail("admin@example.com"),
      }),
    ).toThrow(new PasswordPolicyError("blocked"));
  });

  it("does not reject a strong password merely for containing a blocked word", () => {
    expect(
      validateNewPassword("a long phrase with password inside"),
    ).toBe("a long phrase with password inside");
  });

  it("allows verification normalization without applying a changed blocklist", () => {
    expect(normalizePassword("passwordpassword")).toBe("passwordpassword");
  });
});
