import { describe, expect, it } from "vitest";
import {
  SignJWT,
  base64url,
  decodeJwt,
  decodeProtectedHeader,
} from "jose";

import { InvalidAccessTokenError } from "@chaoran-property-intelligence/application";

import {
  InvalidAccessTokenConfigurationError,
  JoseAccessTokenService,
} from "./joseAccessTokenService.js";

const now = new Date("2026-08-20T20:00:00.000Z");
const nowEpochSeconds = Math.floor(now.getTime() / 1000);
const userId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const tokenId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const issuer = "urn:chaoran-property-intelligence:auth";
const audience = "urn:chaoran-property-intelligence:api";
const signingSecret = base64url.encode(new Uint8Array(32).fill(7));

describe("JoseAccessTokenService", () => {
  it("issues the exact accepted access-token profile", async () => {
    const service = createService();

    const issued = await service.issue({ userId, role: "admin" });
    const header = decodeProtectedHeader(issued.token);
    const payload = decodeJwt(issued.token);

    expect(header).toEqual({ alg: "HS256", typ: "cpi-access+jwt" });
    expect(payload).toEqual({
      role: "admin",
      iss: issuer,
      aud: audience,
      sub: userId,
      jti: tokenId,
      iat: nowEpochSeconds,
      exp: nowEpochSeconds + 3600,
    });
    expect(issued.expiresAtEpochSeconds).toBe(nowEpochSeconds + 3600);
    expect(issued.token).not.toContain("admin@example.com");
  });

  it("verifies a token into application-level candidate identity", async () => {
    const service = createService();
    const issued = await service.issue({ userId, role: "admin" });

    await expect(service.verify(issued.token)).resolves.toEqual({
      userId,
      role: "admin",
      tokenId,
      issuedAtEpochSeconds: nowEpochSeconds,
      expiresAtEpochSeconds: nowEpochSeconds + 3600,
    });
  });

  it("allows only five seconds of expiration clock tolerance", async () => {
    const issuerService = createService();
    const issued = await issuerService.issue({ userId, role: "admin" });
    const withinTolerance = createService(
      new Date(now.getTime() + 3_604_000),
    );
    const outsideTolerance = createService(
      new Date(now.getTime() + 3_606_000),
    );

    await expect(withinTolerance.verify(issued.token)).resolves.toMatchObject({
      userId,
    });
    await expect(outsideTolerance.verify(issued.token)).rejects.toEqual(
      new InvalidAccessTokenError(),
    );
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signProfileToken({}, {}, base64url.encode(
      new Uint8Array(32).fill(9),
    ));

    await expect(createService().verify(token)).rejects.toEqual(
      new InvalidAccessTokenError(),
    );
  });

  it.each([
    ["wrong algorithm", {}, { alg: "HS384" }],
    ["wrong type", {}, { typ: "another+jwt" }],
    ["missing role", { role: undefined }, {}],
    ["invalid role", { role: "viewer" }, {}],
    ["invalid subject", { sub: "not-a-uuid" }, {}],
    ["invalid token id", { jti: "not-a-uuid" }, {}],
    ["wrong issuer", { iss: "urn:wrong:issuer" }, {}],
    ["wrong audience", { aud: "urn:wrong:audience" }, {}],
    ["audience array", { aud: [audience] }, {}],
    ["missing expiration", { exp: undefined }, {}],
    ["unexpected claim", { email: "admin@example.com" }, {}],
    [
      "future issued-at time",
      {
        iat: nowEpochSeconds + 6,
        exp: nowEpochSeconds + 3606,
      },
      {},
    ],
    ["nonstandard lifetime", { exp: nowEpochSeconds + 7200 }, {}],
  ])("rejects %s with the same bounded error", async (_label, claims, header) => {
    const token = await signProfileToken(
      claims as Record<string, unknown>,
      header as { alg?: string; typ?: string },
    );

    await expect(createService().verify(token)).rejects.toEqual(
      new InvalidAccessTokenError(),
    );
  });

  it.each(["", "not-a-token", "a".repeat(4097)])(
    "rejects malformed or unbounded token input",
    async (token) => {
      await expect(createService().verify(token)).rejects.toEqual(
        new InvalidAccessTokenError(),
      );
    },
  );

  it("rejects invalid issue input before signing", async () => {
    const service = createService();

    await expect(
      service.issue({ userId: "not-a-uuid", role: "admin" }),
    ).rejects.toThrow("Invalid access token issue input");
    await expect(
      service.issue({ userId, role: "viewer" as "admin" }),
    ).rejects.toThrow("Invalid access token issue input");
  });

  it.each([
    ["short secret", base64url.encode(new Uint8Array(31)), issuer, audience],
    ["oversized secret", base64url.encode(new Uint8Array(65)), issuer, audience],
    ["padded secret", `${signingSecret}=`, issuer, audience],
    ["invalid secret", "not+base64url", issuer, audience],
    ["blank issuer", signingSecret, " ", audience],
    ["blank audience", signingSecret, issuer, ""],
  ])("rejects bounded configuration: %s", (_label, secret, iss, aud) => {
    expect(
      () =>
        new JoseAccessTokenService({
          signingSecret: secret,
          issuer: iss,
          audience: aud,
        }),
    ).toThrow(InvalidAccessTokenConfigurationError);
  });
});

function createService(currentDate = now): JoseAccessTokenService {
  return new JoseAccessTokenService({
    signingSecret,
    issuer,
    audience,
    now: () => currentDate,
    createTokenId: () => tokenId,
  });
}

async function signProfileToken(
  claimOverrides: Record<string, unknown> = {},
  headerOverrides: { alg?: string; typ?: string } = {},
  secret = signingSecret,
): Promise<string> {
  const claims: Record<string, unknown> = {
    role: "admin",
    iss: issuer,
    aud: audience,
    sub: userId,
    jti: tokenId,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + 3600,
    ...claimOverrides,
  };

  for (const [key, value] of Object.entries(claims)) {
    if (value === undefined) {
      delete claims[key];
    }
  }

  return new SignJWT(claims)
    .setProtectedHeader({
      alg: headerOverrides.alg ?? "HS256",
      typ: headerOverrides.typ ?? "cpi-access+jwt",
    })
    .sign(base64url.decode(secret));
}
