import { describe, expect, it } from "vitest";

import { validateNewPassword } from "@chaoran-property-intelligence/domain";

import { Argon2idPasswordHasher } from "./argon2idPasswordHasher.js";

describe("Argon2idPasswordHasher", () => {
  it("creates a PHC hash with the accepted Argon2id parameters", async () => {
    const hasher = new Argon2idPasswordHasher();

    const hash = await hasher.hash(
      validateNewPassword("a unique password phrase"),
    );

    const segments = hash.split("$");
    expect(segments.slice(0, 3)).toEqual(["", "argon2id", "v=19"]);
    expect(new Set(segments[3]?.split(","))).toEqual(
      new Set(["m=19456", "t=2", "p=1"]),
    );
    expect(segments[4]).toBeTruthy();
    expect(segments[5]).toBeTruthy();
    expect(hash).not.toContain("a unique password phrase");
  });

  it("uses a random salt for every hash", async () => {
    const hasher = new Argon2idPasswordHasher();
    const password = validateNewPassword(
      "a second unique password phrase",
    );

    const firstHash = await hasher.hash(password);
    const secondHash = await hasher.hash(password);

    expect(firstHash).not.toBe(secondHash);
  });

  it("verifies correct and incorrect passwords", async () => {
    const hasher = new Argon2idPasswordHasher();
    const password = validateNewPassword(
      "a third unique password phrase",
    );
    const hash = await hasher.hash(password);

    await expect(hasher.verify(password, hash)).resolves.toBe(true);
    await expect(
      hasher.verify(
        validateNewPassword("a different password phrase"),
        hash,
      ),
    ).resolves.toBe(false);
  });
});
