import { describe, expect, it } from "vitest";

import { normalizePassword } from "@chaoran-property-intelligence/domain";

import { Argon2idPasswordHasher } from "./argon2idPasswordHasher.js";
import { DUMMY_PASSWORD_HASH } from "./dummyPasswordHash.js";

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a valid fixed Argon2id hash with the accepted work factor", async () => {
    const parameters = DUMMY_PASSWORD_HASH.split("$")[3]?.split(",");

    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$/u);
    expect(new Set(parameters)).toEqual(
      new Set(["m=19456", "t=2", "p=1"]),
    );
    await expect(
      new Argon2idPasswordHasher().verify(
        normalizePassword("unknown user password"),
        DUMMY_PASSWORD_HASH,
      ),
    ).resolves.toBe(false);
  });
});
