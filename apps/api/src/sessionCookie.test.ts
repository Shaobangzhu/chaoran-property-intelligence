import { parseSetCookie } from "cookie";
import { describe, expect, it } from "vitest";

import {
  createSessionClearCookie,
  createSessionCookiePolicy,
  createSessionSetCookie,
  readSessionToken,
} from "./sessionCookie.js";

const now = new Date("2026-08-20T20:00:00.000Z");
const nowEpochSeconds = Math.floor(now.getTime() / 1000);

describe("sessionCookie", () => {
  it("creates separate local and production host-only policies", () => {
    expect(createSessionCookiePolicy("local")).toEqual({
      name: "cpi_session",
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: false,
    });
    expect(createSessionCookiePolicy("production")).toEqual({
      name: "__Host-cpi_session",
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    });
  });

  it("serializes a bounded token lifetime and exact clearing policy", () => {
    const policy = createSessionCookiePolicy("production");

    expect(
      parseSetCookie(
        createSessionSetCookie(
          policy,
          "access-token",
          nowEpochSeconds + 3600,
          now,
        ),
      ),
    ).toMatchObject({
      name: "__Host-cpi_session",
      value: "access-token",
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });
    expect(parseSetCookie(createSessionClearCookie(policy))).toMatchObject({
      name: "__Host-cpi_session",
      value: "",
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });
  });

  it.each([
    ["expired", "access-token", nowEpochSeconds],
    ["long lifetime", "access-token", nowEpochSeconds + 3601],
    ["empty token", "", nowEpochSeconds + 3600],
    ["oversized token", "t".repeat(4097), nowEpochSeconds + 3600],
  ])("rejects a %s outside the cookie boundary", (_label, token, expiresAt) => {
    expect(() =>
      createSessionSetCookie(
        createSessionCookiePolicy("local"),
        token,
        expiresAt,
        now,
      ),
    ).toThrow("Session cookie is outside the accepted boundary");
  });

  it("reads only the bounded configured session cookie", () => {
    const policy = createSessionCookiePolicy("local");

    expect(readSessionToken("theme=dark; cpi_session=token", policy)).toBe(
      "token",
    );
    expect(readSessionToken(undefined, policy)).toBeNull();
    expect(readSessionToken("other_session=token", policy)).toBeNull();
    expect(
      readSessionToken(`cpi_session=${"t".repeat(4097)}`, policy),
    ).toBeNull();
    expect(readSessionToken("h".repeat(8193), policy)).toBeNull();
  });
});
