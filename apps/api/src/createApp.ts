import type { ListingRecord } from "@chaoran-property-intelligence/application";
import express, {
  type ErrorRequestHandler,
  type Express,
} from "express";

import {
  type ListListingsResponse,
  toListingSummaryDto,
} from "./listingDto.js";

export interface ListListingsUseCase {
  execute(): Promise<ListingRecord[]>;
}

export interface ApiLogger {
  error(message: string): void;
}

export interface CreateAppOptions {
  listListings: ListListingsUseCase;
  logger: ApiLogger;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/listings", async (_request, response) => {
    const records = await options.listListings.execute();
    const body: ListListingsResponse = {
      listings: records.map(toListingSummaryDto),
    };

    response.status(200).json(body);
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (
    _error,
    _request,
    response,
    _next,
  ) => {
    options.logger.error("GET /api/listings failed");
    response.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to list listings",
      },
    });
  };
  app.use(errorHandler);

  return app;
}
