import {
  AuthenticationRequiredError,
  InvalidCredentialsError,
  type AuthenticatedUser,
  type GetCurrentUserInput,
  type ListingRecord,
  type LoginInput,
  type LoginResult,
} from "@chaoran-property-intelligence/application";
import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import helmet from "helmet";

import type { ApiHttpSecurityConfig } from "./apiConfig.js";
import type { ApiLogContext, ApiLogger } from "./apiLogger.js";
import {
  type ListListingsResponse,
  toListingSummaryDto,
} from "./listingDto.js";
import {
  createLoginRateLimiter,
  defaultLoginRateLimitConfig,
  type LoginRateLimitConfig,
} from "./loginRateLimit.js";
import {
  createOriginVerificationGuard,
  createUnsafeRequestOriginGuard,
} from "./requestSecurity.js";
import {
  createSessionClearCookie,
  createSessionCookiePolicy,
  createSessionSetCookie,
  readSessionToken,
  type SessionCookiePolicy,
} from "./sessionCookie.js";

const jsonBodyLimitBytes = 4_096;
const requestIdHeaderName = "x-request-id";

export type { ApiLogger } from "./apiLogger.js";

export interface ListListingsUseCase {
  execute(): Promise<ListingRecord[]>;
}

export interface LoginUseCase {
  execute(input: LoginInput): Promise<LoginResult>;
}

export interface GetCurrentUserUseCase {
  execute(input: GetCurrentUserInput): Promise<AuthenticatedUser>;
}

export interface CreateAppOptions {
  listListings: ListListingsUseCase;
  login: LoginUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  httpSecurity: ApiHttpSecurityConfig;
  logger: ApiLogger;
  loginRateLimit?: LoginRateLimitConfig;
  now?: () => Date;
  requestIdFactory?: () => string;
}

class AdminAuthorizationRequiredError extends Error {}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const now = options.now ?? (() => new Date());
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const sessionCookiePolicy = createSessionCookiePolicy(
    options.httpSecurity.deploymentMode,
  );

  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity:
        options.httpSecurity.deploymentMode === "production"
          ? { includeSubDomains: true, maxAge: 31_536_000, preload: false }
          : false,
      xFrameOptions: { action: "deny" },
    }),
  );
  app.use((_request, response, next) => {
    const requestId = requestIdFactory();
    response.set("Cache-Control", "no-store");
    response.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.set(requestIdHeaderName, requestId);
    response.locals.requestId = requestId;
    next();
  });
  app.use(
    createOriginVerificationGuard(options.httpSecurity, (_request, response) =>
      options.logger.info(
        "api.origin_verification.rejected",
        readLogContext(response.locals),
      ),
    ),
  );
  app.use(
    createUnsafeRequestOriginGuard(options.httpSecurity, (_request, response) =>
      options.logger.info(
        "api.request_origin.rejected",
        readLogContext(response.locals),
      ),
    ),
  );
  app.post(
    "/api/auth/login",
    createLoginRateLimiter({
      config: options.loginRateLimit ?? defaultLoginRateLimitConfig,
      onRateLimited: (_request, response) =>
        options.logger.info(
          "api.auth.login.rate_limited",
          readLogContext(response.locals),
        ),
    }),
  );
  app.use(
    express.json({
      limit: jsonBodyLimitBytes,
      strict: true,
      type: "application/json",
    }),
  );

  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/api/auth/login", async (request, response) => {
    const input = parseLoginInput(request.body);
    const result = await options.login.execute(input);
    response.setHeader(
      "Set-Cookie",
      createSessionSetCookie(
        sessionCookiePolicy,
        result.accessToken.token,
        result.accessToken.expiresAtEpochSeconds,
        now(),
      ),
    );
    options.logger.info(
      "api.auth.login.succeeded",
      readLogContext(response.locals),
    );
    response.status(200).json({ user: toAuthenticatedUserDto(result.user) });
  });

  app.post("/api/auth/logout", (_request, response) => {
    response.setHeader(
      "Set-Cookie",
      createSessionClearCookie(sessionCookiePolicy),
    );
    response.status(204).end();
  });

  const authenticate = createAuthenticationMiddleware(
    options.getCurrentUser,
    sessionCookiePolicy,
  );
  const requireAdmin = createAdminAuthorizationMiddleware();

  app.get("/api/auth/me", authenticate, (_request, response) => {
    response.status(200).json({
      user: toAuthenticatedUserDto(readAuthenticatedUser(response.locals)),
    });
  });

  app.get(
    "/api/listings",
    authenticate,
    requireAdmin,
    async (_request, response) => {
      const records = await options.listListings.execute();
      const body: ListListingsResponse = {
        listings: records.map(toListingSummaryDto),
      };

      response.status(200).json(body);
    },
  );

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof InvalidCredentialsError) {
      options.logger.info(
        "api.auth.login.rejected",
        readLogContext(response.locals),
      );
      response.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
      return;
    }

    if (error instanceof AuthenticationRequiredError) {
      options.logger.info(
        "api.auth.session.rejected",
        readLogContext(response.locals),
      );
      response.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required",
        },
      });
      return;
    }

    if (error instanceof AdminAuthorizationRequiredError) {
      options.logger.info(
        "api.authorization.admin.rejected",
        readLogContext(response.locals),
      );
      response.status(403).json({
        error: {
          code: "ADMIN_AUTHORIZATION_REQUIRED",
          message: "Administrator authorization is required",
        },
      });
      return;
    }

    if (error instanceof InvalidRequestBodyError || isBodyParserError(error)) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Request body is invalid",
        },
      });
      return;
    }

    options.logger.error("api.request.failed", readLogContext(response.locals));
    response.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Request could not be completed",
      },
    });
  };
  app.use(errorHandler);

  return app;
}

function createAdminAuthorizationMiddleware(): RequestHandler {
  return (_request, response, next) => {
    const user = readAuthenticatedUser(response.locals);
    if (user.role !== "admin") {
      throw new AdminAuthorizationRequiredError();
    }
    next();
  };
}

function createAuthenticationMiddleware(
  getCurrentUser: GetCurrentUserUseCase,
  sessionCookiePolicy: SessionCookiePolicy,
): RequestHandler {
  return async (request, response, next) => {
    const accessToken = readSessionToken(
      request.headers.cookie,
      sessionCookiePolicy,
    );
    if (accessToken === null) {
      throw new AuthenticationRequiredError();
    }

    response.locals.authenticatedUser = await getCurrentUser.execute({
      accessToken,
    });
    next();
  };
}

function parseLoginInput(value: unknown): LoginInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRequestBodyError();
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !keys.includes("email") ||
    !keys.includes("password") ||
    typeof record.email !== "string" ||
    typeof record.password !== "string"
  ) {
    throw new InvalidRequestBodyError();
  }

  return {
    email: record.email,
    password: record.password,
  };
}

function toAuthenticatedUserDto(user: AuthenticatedUser): {
  id: string;
  email: string;
  role: AuthenticatedUser["role"];
} {
  return {
    id: user.id,
    email: user.normalizedEmail,
    role: user.role,
  };
}

function readAuthenticatedUser(
  locals: Record<string, unknown>,
): AuthenticatedUser {
  const user = locals.authenticatedUser;
  if (user === undefined) {
    throw new Error("Authentication middleware did not provide a user");
  }
  return user as AuthenticatedUser;
}

function readLogContext(locals: Record<string, unknown>): ApiLogContext {
  const requestId = locals.requestId;
  if (typeof requestId !== "string") {
    throw new Error("Request context did not provide a request ID");
  }
  return { requestId };
}

function isBodyParserError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return false;
  }
  return (
    error.type === "entity.parse.failed" || error.type === "entity.too.large"
  );
}

class InvalidRequestBodyError extends Error {
  constructor() {
    super("Request body is invalid");
    this.name = "InvalidRequestBodyError";
  }
}
