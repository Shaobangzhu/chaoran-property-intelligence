import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = readPort(process.argv);
const user = {
  email: "admin@example.com",
  id: "0198c7d2-7668-7775-b0fc-b789690a60a0",
  role: "admin",
};
const listing = {
  addressLine1: "123 Main St",
  addressLine2: null,
  bathrooms: 2.5,
  bedrooms: 4,
  city: "Eastvale",
  firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
  formattedAddress: "123 Main St, Eastvale, CA 92880",
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  lastSeenDate: "2026-08-19",
  latitude: 33.9525,
  listedDate: "2026-08-19",
  longitude: -117.5848,
  mlsName: "CRMLS",
  mlsNumber: "IG26000001",
  price: 825000,
  propertyType: "Single Family",
  source: "rentcast",
  sourceListingId: "rentcast-listing-id",
  state: "CA",
  status: "Active",
  zipCode: "92880",
};

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`CPI local Playwright API stub listening on ${port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

async function handleRequest(request, response) {
  applyDefaultHeaders(response);

  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJsonBody(request);
    if (
      body?.email === "admin@example.com" &&
      body?.password === "correct horse battery staple!"
    ) {
      response.setHeader(
        "Set-Cookie",
        "cpi_session=playwright-local-session; HttpOnly; Path=/; SameSite=Strict; Max-Age=3600",
      );
      sendJson(response, 200, { user });
      return;
    }

    sendJson(response, 401, { error: { code: "INVALID_CREDENTIALS" } });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    response.writeHead(204, {
      "Set-Cookie":
        "cpi_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0",
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/me") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required",
        },
      });
      return;
    }

    sendJson(response, 200, { user });
    return;
  }

  if (method === "GET" && url.pathname === "/api/listings") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required",
        },
      });
      return;
    }

    sendJson(response, 200, { listings: [listing] });
    return;
  }

  sendJson(response, 404, { error: { code: "NOT_FOUND" } });
}

function applyDefaultHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Request-Id", randomUUID());
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function isAuthenticated(request) {
  return /(?:^|;\s*)cpi_session=playwright-local-session(?:;|$)/u.test(
    request.headers.cookie ?? "",
  );
}

function readPort(argv) {
  const index = argv.indexOf("--port");
  const value = index === -1 ? undefined : argv[index + 1];
  const port = value === undefined ? 3_100 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be a valid TCP port");
  }
  return port;
}
