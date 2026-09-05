import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { restorePreviousReportArtifacts } from "./restoreReportArtifacts.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("restorePreviousReportArtifacts", () => {
  it("downloads one exact report artifact per prior completed workflow run", async () => {
    const root = await createTemporaryDirectory();
    const requests = [];
    const fetchImplementation = vi.fn(async (url, options) => {
      requests.push({ options, url });
      if (url.includes("/workflows/")) {
        return jsonResponse({
          workflow_runs: [{ id: 400 }, { id: 300 }, { id: 200 }],
        });
      }
      if (url.includes("/runs/300/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              archive_download_url: "https://api.github.com/artifacts/30/zip",
              expired: false,
              id: 30,
              name: "allure-pages-report-300",
            },
          ],
        });
      }
      if (url.includes("/runs/200/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              archive_download_url: "https://api.github.com/artifacts/20/zip",
              expired: false,
              id: 20,
              name: "allure-pages-report-200-untrusted-suffix",
            },
          ],
        });
      }
      if (url === "https://api.github.com/artifacts/30/zip") {
        return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const restored = await restorePreviousReportArtifacts({
      artifactPrefix: "allure-pages-report-",
      currentRunId: "400",
      fetchImplementation,
      outputDirectory: root,
      repository: "owner/repository",
      token: "test-token",
      workflow: "nightly-dev-regression.yml",
    });

    expect(restored).toEqual([{ artifactId: "30", runId: "300" }]);
    expect(await readdir(root)).toEqual(["300-30.zip"]);
    expect(new Uint8Array(await readFile(path.join(root, "300-30.zip")))).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(requests.every(({ options }) =>
      options.headers.authorization === "Bearer test-token",
    )).toBe(true);
  });

  it("rejects unsuccessful artifact downloads without exposing the token", async () => {
    const root = await createTemporaryDirectory();
    const fetchImplementation = vi.fn(async (url) => {
      if (url.includes("/workflows/")) {
        return jsonResponse({ workflow_runs: [{ id: 300 }] });
      }
      if (url.includes("/runs/300/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              archive_download_url: "https://api.github.com/artifacts/30/zip",
              expired: false,
              id: 30,
              name: "allure-pages-report-300",
            },
          ],
        });
      }
      return new Response("forbidden", { status: 403 });
    });

    await expect(
      restorePreviousReportArtifacts({
        artifactPrefix: "allure-pages-report-",
        currentRunId: "400",
        fetchImplementation,
        outputDirectory: root,
        repository: "owner/repository",
        token: "sensitive-token",
        workflow: "nightly-dev-regression.yml",
      }),
    ).rejects.toThrow("HTTP 403");
  });
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpi-report-state-"));
  temporaryDirectories.push(directory);
  return directory;
}
