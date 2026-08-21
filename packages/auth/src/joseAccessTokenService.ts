import { randomUUID } from "node:crypto";

import {
  InvalidAccessTokenError,
  type IssueAccessTokenInput,
  type IssuedAccessToken,
  type TokenServicePort,
  type VerifiedAccessToken,
} from "@chaoran-property-intelligence/application";
import { isUserRole } from "@chaoran-property-intelligence/domain";
import { SignJWT, base64url, jwtVerify } from "jose";

const algorithm = "HS256";
const tokenType = "cpi-access+jwt";
const tokenLifetimeSeconds = 60 * 60;
const clockToleranceSeconds = 5;
const maximumTokenLength = 4096;
const minimumSecretBytes = 32;
const maximumSecretBytes = 64;
const maximumIdentifierLength = 200;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const requiredClaims = [
  "sub",
  "role",
  "iat",
  "exp",
  "iss",
  "aud",
  "jti",
];

const allowedHeaderNames = new Set(["alg", "typ"]);
const allowedClaimNames = new Set(requiredClaims);

export interface JoseAccessTokenServiceConfig {
  signingSecret: string;
  issuer: string;
  audience: string;
}

export interface JoseAccessTokenServiceOptions
  extends JoseAccessTokenServiceConfig {
  now?: () => Date;
  createTokenId?: () => string;
}

export class InvalidAccessTokenConfigurationError extends Error {
  constructor() {
    super("Invalid access token configuration");
    this.name = "InvalidAccessTokenConfigurationError";
  }
}

export class JoseAccessTokenService implements TokenServicePort {
  private readonly signingKey: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly now: () => Date;
  private readonly createTokenId: () => string;

  constructor(options: JoseAccessTokenServiceOptions) {
    this.signingKey = decodeSigningSecret(options.signingSecret);
    this.issuer = validateIdentifier(options.issuer);
    this.audience = validateIdentifier(options.audience);
    this.now = options.now ?? (() => new Date());
    this.createTokenId = options.createTokenId ?? randomUUID;
  }

  async issue(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    const issuedAt = this.readCurrentEpochSeconds();
    const expiresAt = issuedAt + tokenLifetimeSeconds;
    const tokenId = this.createTokenId();

    if (
      !isUuid(input.userId) ||
      !isUserRole(input.role) ||
      !isUuid(tokenId)
    ) {
      throw new Error("Invalid access token issue input");
    }

    const token = await new SignJWT({ role: input.role })
      .setProtectedHeader({ alg: algorithm, typ: tokenType })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(input.userId)
      .setJti(tokenId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.signingKey);

    return {
      token,
      expiresAtEpochSeconds: expiresAt,
    };
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      if (token.length === 0 || token.length > maximumTokenLength) {
        throw new Error("Invalid token length");
      }

      const currentDate = this.readCurrentDate();
      const { payload, protectedHeader } = await jwtVerify(
        token,
        this.signingKey,
        {
          algorithms: [algorithm],
          issuer: this.issuer,
          audience: this.audience,
          typ: tokenType,
          requiredClaims,
          maxTokenAge: tokenLifetimeSeconds,
          clockTolerance: clockToleranceSeconds,
          currentDate,
        },
      );

      if (
        protectedHeader.alg !== algorithm ||
        protectedHeader.typ !== tokenType ||
        !hasOnlyKeys(protectedHeader, allowedHeaderNames) ||
        !hasOnlyKeys(payload, allowedClaimNames) ||
        !isUuid(payload.sub) ||
        !isUserRole(payload.role) ||
        !isUuid(payload.jti) ||
        payload.iss !== this.issuer ||
        payload.aud !== this.audience ||
        !isEpochSeconds(payload.iat) ||
        !isEpochSeconds(payload.exp) ||
        payload.exp - payload.iat !== tokenLifetimeSeconds
      ) {
        throw new Error("Token did not match the accepted profile");
      }

      return {
        userId: payload.sub,
        role: payload.role,
        tokenId: payload.jti,
        issuedAtEpochSeconds: payload.iat,
        expiresAtEpochSeconds: payload.exp,
      };
    } catch {
      throw new InvalidAccessTokenError();
    }
  }

  private readCurrentEpochSeconds(): number {
    return Math.floor(this.readCurrentDate().getTime() / 1000);
  }

  private readCurrentDate(): Date {
    const date = this.now();
    if (!Number.isFinite(date.getTime())) {
      throw new Error("Invalid access token clock");
    }
    return date;
  }
}

function decodeSigningSecret(value: string): Uint8Array {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
      throw new Error("Secret is not base64url");
    }
    const decoded = base64url.decode(value);
    if (
      decoded.byteLength < minimumSecretBytes ||
      decoded.byteLength > maximumSecretBytes ||
      base64url.encode(decoded) !== value
    ) {
      throw new Error("Secret is outside the accepted boundary");
    }
    return decoded;
  } catch {
    throw new InvalidAccessTokenConfigurationError();
  }
}

function validateIdentifier(value: string): string {
  if (
    value.length === 0 ||
    value.length > maximumIdentifierLength ||
    value.trim() !== value
  ) {
    throw new InvalidAccessTokenConfigurationError();
  }
  return value;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowedKeys.size &&
    keys.every((key) => allowedKeys.has(key))
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isEpochSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
