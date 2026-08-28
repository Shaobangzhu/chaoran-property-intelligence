import { timingSafeEqual } from "node:crypto";

import type { Request, RequestHandler, Response } from "express";

import type { ApiHttpSecurityConfig } from "./apiConfig.js";

export const originVerificationHeaderName = "x-cpi-origin-verification";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type SecurityRejectionHandler = (
  request: Request,
  response: Response,
) => void;

export function createOriginVerificationGuard(
  config: ApiHttpSecurityConfig,
  onRejected?: SecurityRejectionHandler,
): RequestHandler {
  return (request, response, next) => {
    if (
      config.deploymentMode === "local" ||
      (request.method === "GET" && request.path === "/api/health")
    ) {
      next();
      return;
    }

    const receivedSecret = request.get(originVerificationHeaderName);
    if (
      config.originVerificationSecret === null ||
      !secretsMatch(receivedSecret, config.originVerificationSecret)
    ) {
      onRejected?.(request, response);
      response.status(403).json({
        error: {
          code: "ORIGIN_VERIFICATION_FAILED",
          message: "API origin verification failed",
        },
      });
      return;
    }

    next();
  };
}

export function createUnsafeRequestOriginGuard(
  config: ApiHttpSecurityConfig,
  onRejected?: SecurityRejectionHandler,
): RequestHandler {
  return (request, response, next) => {
    if (!unsafeMethods.has(request.method)) {
      next();
      return;
    }

    const expectedOrigin =
      config.publicOrigin ??
      (config.trustedPublicOriginHeaderName === null
        ? undefined
        : request.get(config.trustedPublicOriginHeaderName));
    if (
      expectedOrigin === undefined ||
      request.get("Origin") !== expectedOrigin
    ) {
      onRejected?.(request, response);
      response.status(403).json({
        error: {
          code: "REQUEST_ORIGIN_REJECTED",
          message: "Request origin is not allowed",
        },
      });
      return;
    }

    next();
  };
}

function secretsMatch(received: string | undefined, expected: string): boolean {
  if (received === undefined) {
    return false;
  }

  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}
