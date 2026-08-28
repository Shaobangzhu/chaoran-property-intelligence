import { pathToFileURL } from "node:url";

export async function waitForHealthyHttp({
  attempts = 60,
  delay = wait,
  fetchImplementation = globalThis.fetch,
  intervalMs = 5_000,
  requestTimeoutMs = 5_000,
  url,
}) {
  const target = validateTarget(url);
  let lastResult = "no response";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImplementation(target, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.status === 200) {
        const body = await response.json();
        if (body?.status === "ok") {
          return { attempt, status: response.status };
        }
        lastResult = "HTTP 200 with an invalid health body";
      } else {
        lastResult = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastResult = error instanceof Error ? error.message : "request failed";
    }

    if (attempt < attempts) {
      await delay(intervalMs);
    }
  }

  throw new Error(
    `Health endpoint was not ready after ${attempts} attempts: ${lastResult}`,
  );
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const result = await waitForHealthyHttp(args);
  process.stdout.write(
    `Health endpoint became ready on attempt ${result.attempt}.\n`,
  );
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--url") {
      values.url = value;
    } else if (name === "--attempts") {
      values.attempts = readPositiveInteger(name, value);
    } else if (name === "--interval-ms") {
      values.intervalMs = readPositiveInteger(name, value);
    } else if (name === "--request-timeout-ms") {
      values.requestTimeoutMs = readPositiveInteger(name, value);
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  if (values.url === undefined) {
    throw new Error("--url is required");
  }
  return values;
}

function readPositiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function validateTarget(value) {
  const target = new URL(value);
  if (target.protocol !== "https:") {
    throw new Error("Health endpoint must use HTTPS");
  }
  return target;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
