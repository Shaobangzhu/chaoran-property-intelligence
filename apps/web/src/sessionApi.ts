export interface AuthenticatedUser {
  id: string;
  email: string;
  role: "admin";
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SessionClient {
  getCurrentUser(signal?: AbortSignal): Promise<AuthenticatedUser | null>;
  login(input: LoginInput): Promise<AuthenticatedUser>;
  logout(): Promise<void>;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class LoginRateLimitedError extends Error {
  constructor() {
    super("Login rate limited");
    this.name = "LoginRateLimitedError";
  }
}

class SessionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRequestError";
  }
}

export function createSessionClient(
  fetchImplementation: FetchImplementation = fetch,
): SessionClient {
  return {
    async getCurrentUser(signal) {
      const request: RequestInit = {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
      };
      if (signal !== undefined) {
        request.signal = signal;
      }

      const response = await fetchImplementation("/api/auth/me", request);
      if (response.status === 401) {
        return null;
      }
      if (!response.ok) {
        throw new SessionRequestError("Unable to check session");
      }

      return parseSessionResponse(await readJson(response));
    },

    async login(input) {
      const response = await fetchImplementation("/api/auth/login", {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (response.status === 401) {
        throw new InvalidCredentialsError();
      }
      if (response.status === 429) {
        throw new LoginRateLimitedError();
      }
      if (!response.ok) {
        throw new SessionRequestError("Unable to sign in");
      }

      return parseSessionResponse(await readJson(response));
    },

    async logout() {
      const response = await fetchImplementation("/api/auth/logout", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "POST",
      });
      if (response.status !== 204) {
        throw new SessionRequestError("Unable to sign out");
      }
    },
  };
}

export const sessionClient = createSessionClient();

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

function parseSessionResponse(value: unknown): AuthenticatedUser {
  if (!hasExactKeys(value, ["user"])) {
    throw invalidResponse();
  }

  const user = value.user;
  if (!hasExactKeys(user, ["email", "id", "role"])) {
    throw invalidResponse();
  }
  if (
    typeof user.id !== "string" ||
    user.id.length === 0 ||
    typeof user.email !== "string" ||
    user.email.length === 0 ||
    user.role !== "admin"
  ) {
    throw invalidResponse();
  }

  return { email: user.email, id: user.id, role: user.role };
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function invalidResponse(): Error {
  return new SessionRequestError("Session response was invalid");
}
