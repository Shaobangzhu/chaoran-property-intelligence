import { describe, expect, it, vi } from "vitest";

import {
  InvalidCredentialsError,
  LoginRateLimitedError,
  createSessionClient,
} from "./sessionApi.js";

describe("session API client", () => {
  it("returns the authenticated user from the current-session endpoint", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ user: authenticatedUser }),
    );
    const client = createSessionClient(fetchImplementation);

    await expect(client.getCurrentUser()).resolves.toEqual(authenticatedUser);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("treats a 401 current-session response as signed out", async () => {
    const client = createSessionClient(
      vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)),
    );

    await expect(client.getCurrentUser()).resolves.toBeNull();
  });

  it("submits credentials without exposing server error bodies", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ user: authenticatedUser }),
    );
    const client = createSessionClient(fetchImplementation);

    await expect(
      client.login({ email: "admin@example.com", password: "correct horse" }),
    ).resolves.toEqual(authenticatedUser);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        body: JSON.stringify({
          email: "admin@example.com",
          password: "correct horse",
        }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("maps credential and rate-limit failures to typed errors", async () => {
    const invalidClient = createSessionClient(
      vi.fn(async () =>
        jsonResponse({ error: "database host should stay hidden" }, 401),
      ),
    );
    const limitedClient = createSessionClient(
      vi.fn(async () => jsonResponse({ error: "slow down" }, 429)),
    );

    await expect(
      invalidClient.login({ email: "admin@example.com", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      limitedClient.login({ email: "admin@example.com", password: "wrong" }),
    ).rejects.toBeInstanceOf(LoginRateLimitedError);
  });

  it("rejects malformed user DTOs", async () => {
    const client = createSessionClient(
      vi.fn(async () =>
        jsonResponse({ user: { ...authenticatedUser, role: "viewer" } }),
      ),
    );

    await expect(client.getCurrentUser()).rejects.toThrow(
      "Session response was invalid",
    );
  });

  it("posts logout using the browser session", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createSessionClient(fetchImplementation);

    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
  });
});

const authenticatedUser = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  email: "admin@example.com",
  role: "admin",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
