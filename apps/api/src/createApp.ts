import {
  AuthenticationRequiredError,
  CurrentShowingListDraftChangedError,
  CurrentShowingListDraftNotFoundError,
  type ArchiveManualListingInput,
  type CreateManualListingInput,
  InvalidListingSearchCriteriaInputError,
  InvalidManualListingPatchError,
  InvalidShowingListReviewInputError,
  InvalidCredentialsError,
  InvalidManualListingError,
  ListingSearchCriteriaChangedError,
  ManualListingNotFoundError,
  ShowingListArtifactChangedError,
  ShowingListArtifactReaderInvalidResponseError,
  ShowingListArtifactReaderUnavailableError,
  type UpdateManualListingInput,
  type AuthenticatedUser,
  type GetCurrentUserInput,
  type ListingRecord,
  type ListingSearchCriteriaResult,
  type LoginInput,
  type LoginResult,
  type ManualListingRecord,
  type CurrentShowingListDraft,
  type MarkCurrentShowingListDraftReviewedInput,
  type RenderedShowingListArtifact,
  type SaveCurrentShowingListDraftInput,
  type UpdateListingSearchCriteriaInput,
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
  InvalidListingSearchCriteriaRequestError,
  parseUpdateListingSearchCriteriaRequest,
  toListingSearchCriteriaResponse,
} from "./listingSearchCriteriaDto.js";
import {
  InvalidManualListingRequestError,
  parseManualListingDraftDto,
  parseManualListingPatchDto,
  toCreateManualListingResponse,
  toUpdateManualListingResponse,
} from "./manualListingDto.js";
import {
  InvalidShowingListRequestError,
  parseMarkCurrentShowingListDraftReviewedRequest,
  parseSaveCurrentShowingListDraftRequest,
  toCurrentShowingListDraftDto,
  type GetCurrentShowingListDraftResponse,
} from "./showingListDto.js";
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

const loginJsonBodyLimitBytes = 4_096;
const listingSearchCriteriaJsonBodyLimitBytes = 4_096;
const manualListingJsonBodyLimitBytes = 8_192;
const showingListJsonBodyLimitBytes = 256 * 1_024;
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

export interface CreateManualListingUseCase {
  execute(input: CreateManualListingInput): Promise<ManualListingRecord>;
}

export interface UpdateManualListingUseCase {
  execute(input: UpdateManualListingInput): Promise<ManualListingRecord>;
}

export interface ArchiveManualListingUseCase {
  execute(input: ArchiveManualListingInput): Promise<void>;
}

export interface GetCurrentShowingListDraftUseCase {
  execute(): Promise<CurrentShowingListDraft | null>;
}

export interface SaveCurrentShowingListDraftUseCase {
  execute(
    input: SaveCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft>;
}

export interface MarkCurrentShowingListDraftReviewedUseCase {
  execute(
    input: MarkCurrentShowingListDraftReviewedInput,
  ): Promise<CurrentShowingListDraft>;
}

export interface GetCurrentShowingListArtifactUseCase {
  execute(): Promise<RenderedShowingListArtifact>;
}

export interface GetListingSearchCriteriaUseCase {
  execute(): Promise<ListingSearchCriteriaResult>;
}

export interface UpdateListingSearchCriteriaUseCase {
  execute(
    input: UpdateListingSearchCriteriaInput,
  ): Promise<ListingSearchCriteriaResult>;
}

export interface CreateAppOptions {
  archiveManualListing: ArchiveManualListingUseCase;
  createManualListing: CreateManualListingUseCase;
  listListings: ListListingsUseCase;
  login: LoginUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  getCurrentShowingListArtifact: GetCurrentShowingListArtifactUseCase;
  getCurrentShowingListDraft: GetCurrentShowingListDraftUseCase;
  getListingSearchCriteria: GetListingSearchCriteriaUseCase;
  httpSecurity: ApiHttpSecurityConfig;
  logger: ApiLogger;
  loginRateLimit?: LoginRateLimitConfig;
  now?: () => Date;
  requestIdFactory?: () => string;
  markCurrentShowingListDraftReviewed: MarkCurrentShowingListDraftReviewedUseCase;
  saveCurrentShowingListDraft: SaveCurrentShowingListDraftUseCase;
  updateListingSearchCriteria: UpdateListingSearchCriteriaUseCase;
  updateManualListing: UpdateManualListingUseCase;
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
    createJsonBodyParser(loginJsonBodyLimitBytes),
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
    "/api/showing-list/current",
    authenticate,
    requireAdmin,
    async (_request, response) => {
      const current = await options.getCurrentShowingListDraft.execute();
      const body: GetCurrentShowingListDraftResponse = {
        current:
          current === null ? null : toCurrentShowingListDraftDto(current),
      };
      response.status(200).json(body);
    },
  );

  app.patch(
    "/api/showing-list/current",
    authenticate,
    requireAdmin,
    createJsonBodyParser(showingListJsonBodyLimitBytes),
    async (request, response) => {
      const current = await options.saveCurrentShowingListDraft.execute(
        parseSaveCurrentShowingListDraftRequest(request.body),
      );
      options.logger.info(
        "api.showing_list.current.saved",
        readLogContext(response.locals),
      );
      response.status(200).json({
        current: toCurrentShowingListDraftDto(current),
      });
    },
  );

  app.post(
    "/api/showing-list/current/review",
    authenticate,
    requireAdmin,
    createJsonBodyParser(showingListJsonBodyLimitBytes),
    async (request, response) => {
      const current =
        await options.markCurrentShowingListDraftReviewed.execute(
          parseMarkCurrentShowingListDraftReviewedRequest(request.body),
        );
      options.logger.info(
        "api.showing_list.current.reviewed",
        readLogContext(response.locals),
      );
      response.status(200).json({
        current: toCurrentShowingListDraftDto(current),
      });
    },
  );

  app.get(
    "/api/showing-list/current/download",
    authenticate,
    requireAdmin,
    async (_request, response) => {
      const artifact = await options.getCurrentShowingListArtifact.execute();
      response.set("Content-Type", artifact.mediaType);
      response.set(
        "Content-Disposition",
        `attachment; filename="${artifact.fileName}"`,
      );
      response.set("Content-Length", String(artifact.bytes.byteLength));
      response.status(200).send(Buffer.from(artifact.bytes));
    },
  );

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

  app.get(
    "/api/listing-search-criteria",
    authenticate,
    requireAdmin,
    async (_request, response) => {
      const result = await options.getListingSearchCriteria.execute();
      response.status(200).json(toListingSearchCriteriaResponse(result));
    },
  );

  app.put(
    "/api/listing-search-criteria",
    authenticate,
    requireAdmin,
    createListingSearchCriteriaJsonBodyParser(),
    async (request, response) => {
      const actor = readAuthenticatedUser(response.locals);
      const input = parseUpdateListingSearchCriteriaRequest(request.body);
      const result = await options.updateListingSearchCriteria.execute({
        actorUserId: actor.id,
        expectedRevision: input.expectedRevision,
        criteria: input.criteria,
      });

      options.logger.info(
        "api.listing_search_criteria.updated",
        readLogContext(response.locals),
      );
      response.status(200).json(toListingSearchCriteriaResponse(result));
    },
  );

  app.post(
    "/api/listings/manual",
    authenticate,
    requireAdmin,
    createJsonBodyParser(manualListingJsonBodyLimitBytes),
    async (request, response) => {
      const actor = readAuthenticatedUser(response.locals);
      const record = await options.createManualListing.execute({
        actorUserId: actor.id,
        draft: parseManualListingDraftDto(request.body),
      });

      options.logger.info(
        "api.listings.manual.created",
        readLogContext(response.locals),
      );
      response.status(201).json(toCreateManualListingResponse(record));
    },
  );

  app.patch(
    "/api/listings/:id",
    authenticate,
    requireAdmin,
    createJsonBodyParser(manualListingJsonBodyLimitBytes),
    async (request, response) => {
      const record = await options.updateManualListing.execute({
        listingId: readRouteParameter(request.params.id),
        patch: parseManualListingPatchDto(request.body),
      });

      options.logger.info(
        "api.listings.manual.updated",
        readLogContext(response.locals),
      );
      response.status(200).json(toUpdateManualListingResponse(record));
    },
  );

  app.post(
    "/api/listings/:id/archive",
    authenticate,
    requireAdmin,
    async (request, response) => {
      await options.archiveManualListing.execute({
        listingId: readRouteParameter(request.params.id),
      });
      options.logger.info(
        "api.listings.manual.archived",
        readLogContext(response.locals),
      );
      response.status(204).end();
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

    if (
      error instanceof InvalidListingSearchCriteriaRequestError ||
      error instanceof InvalidListingSearchCriteriaInputError
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_LISTING_SEARCH_CRITERIA",
          message: "Listing search criteria are invalid",
        },
      });
      return;
    }

    if (
      error instanceof InvalidRequestBodyError ||
      error instanceof InvalidManualListingRequestError ||
      error instanceof InvalidManualListingPatchError ||
      error instanceof InvalidShowingListRequestError ||
      error instanceof InvalidShowingListReviewInputError ||
      isBodyParserError(error)
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Request body is invalid",
        },
      });
      return;
    }

    if (error instanceof ListingSearchCriteriaChangedError) {
      response.status(409).json({
        error: {
          code: "LISTING_SEARCH_CRITERIA_CHANGED",
          message: "Listing search criteria changed; reload before continuing",
        },
      });
      return;
    }

    if (error instanceof CurrentShowingListDraftChangedError) {
      response.status(409).json({
        error: {
          code: "SHOWING_LIST_CHANGED",
          message: "Showing List draft changed; reload before continuing",
        },
      });
      return;
    }

    if (error instanceof CurrentShowingListDraftNotFoundError) {
      response.status(404).json({
        error: {
          code: "SHOWING_LIST_NOT_FOUND",
          message: "Showing List draft was not found",
        },
      });
      return;
    }

    if (error instanceof ShowingListArtifactChangedError) {
      response.status(409).json({
        error: {
          code: "SHOWING_LIST_CHANGED",
          message: "Showing List draft changed; reload before continuing",
        },
      });
      return;
    }

    if (
      error instanceof ShowingListArtifactReaderUnavailableError ||
      error instanceof ShowingListArtifactReaderInvalidResponseError
    ) {
      response.status(503).json({
        error: {
          code: "SHOWING_LIST_DOWNLOAD_UNAVAILABLE",
          message: "Showing List download is temporarily unavailable",
        },
      });
      return;
    }

    if (error instanceof ManualListingNotFoundError) {
      response.status(404).json({
        error: {
          code: "MANUAL_LISTING_NOT_FOUND",
          message: "Manual listing was not found",
        },
      });
      return;
    }

    if (
      error instanceof InvalidManualListingError &&
      error.field !== "actorUserId"
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_MANUAL_LISTING",
          field: error.field,
          message: "Manual listing is invalid",
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

function readRouteParameter(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function createJsonBodyParser(limit: number): RequestHandler {
  return express.json({
    limit,
    strict: true,
    type: "application/json",
  });
}

function createListingSearchCriteriaJsonBodyParser(): RequestHandler {
  const parser = createJsonBodyParser(listingSearchCriteriaJsonBodyLimitBytes);
  return (request, response, next) => {
    parser(request, response, (error?: unknown) => {
      next(
        error === undefined
          ? undefined
          : new InvalidListingSearchCriteriaRequestError(),
      );
    });
  };
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
