import { parseCookie, stringifySetCookie } from "cookie";

import type { ApiDeploymentMode } from "./apiConfig.js";

const maximumCookieHeaderLength = 8_192;
const maximumAccessTokenLength = 4_096;
const maximumAccessTokenLifetimeSeconds = 60 * 60;

export interface SessionCookiePolicy {
  name: "cpi_session" | "__Host-cpi_session";
  httpOnly: true;
  path: "/";
  sameSite: "strict";
  secure: boolean;
}

export function createSessionCookiePolicy(
  deploymentMode: ApiDeploymentMode,
): SessionCookiePolicy {
  return {
    name:
      deploymentMode === "production"
        ? "__Host-cpi_session"
        : "cpi_session",
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: deploymentMode === "production",
  };
}

export function createSessionSetCookie(
  policy: SessionCookiePolicy,
  token: string,
  expiresAtEpochSeconds: number,
  now: Date,
): string {
  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  const maxAge = expiresAtEpochSeconds - nowEpochSeconds;

  if (
    token.length === 0 ||
    token.length > maximumAccessTokenLength ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(expiresAtEpochSeconds) ||
    maxAge < 1 ||
    maxAge > maximumAccessTokenLifetimeSeconds
  ) {
    throw new Error("Session cookie is outside the accepted boundary");
  }

  return stringifySetCookie({
    ...policy,
    value: token,
    maxAge,
    expires: new Date(expiresAtEpochSeconds * 1000),
  });
}

export function createSessionClearCookie(policy: SessionCookiePolicy): string {
  return stringifySetCookie({
    ...policy,
    value: "",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function readSessionToken(
  cookieHeader: string | undefined,
  policy: SessionCookiePolicy,
): string | null {
  if (
    cookieHeader === undefined ||
    cookieHeader.length === 0 ||
    cookieHeader.length > maximumCookieHeaderLength
  ) {
    return null;
  }

  const token = parseCookie(cookieHeader)[policy.name];
  if (
    token === undefined ||
    token.length === 0 ||
    token.length > maximumAccessTokenLength
  ) {
    return null;
  }
  return token;
}
