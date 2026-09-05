import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { restorePreviousWorkflowArtifact } from "./restoreWorkflowArtifact.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("restorePreviousWorkflowArtifact", () => {
  it("downloads the newest non-expired matching artifact from a prior workflow run", async () => {
    const root = await createTemporaryDirectory();
    const outputZip = path.join(root, "state.zip");
    const requests = [];
    const fetchImplementation = vi.fn(async (url, options) => {
      requests.push({ options, url });
      if (url.includes("/workflows/")) {
        return jsonResponse({
          workflow_runs: [{ id: 300 }, { id: 200 }],
        });
      }
      if (url.includes("/runs/300/artifacts")) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes("/runs/200/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              archive_download_url: "https://api.github.com/artifacts/42/zip",
              expired: false,
              name: "allure-history-state",
            },
          ],
        });
      }
      if (url === "https://api.github.com/artifacts/42/zip") {
        return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await restorePreviousWorkflowArtifact({
      artifactName: "allure-history-state",
      currentRunId: "400",
      fetchImplementation,
      outputZip,
      repository: "owner/repository",
      token: "test-token",
      workflow: "nightly-dev-regression.yml",
    });

    expect(result).toEqual({ found: true, sourceRunId: "200" });
    expect(new Uint8Array(await readFile(outputZip))).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(requests.every(({ options }) =>
      options.headers.authorization === "Bearer test-token",
    )).toBe(true);
  });

  it("returns a clean miss when no prior run has the requested artifact", async () => {
    const root = await createTemporaryDirectory();
    const outputZip = path.join(root, "state.zip");
    const fetchImplementation = vi.fn(async (url) => {
      if (url.includes("/workflows/")) {
        return jsonResponse({ workflow_runs: [{ id: 200 }] });
      }
      return jsonResponse({ artifacts: [] });
    });

    const result = await restorePreviousWorkflowArtifact({
      artifactName: "allure-history-state",
      currentRunId: "300",
      fetchImplementation,
      outputZip,
      repository: "owner/repository",
      token: "test-token",
      workflow: "nightly-dev-regression.yml",
    });

    expect(result).toEqual({ found: false, sourceRunId: undefined });
    await expect(pathExists(outputZip)).resolves.toBe(false);
  });

  it("rejects unsuccessful GitHub API responses without exposing the token", async () => {
    const root = await createTemporaryDirectory();
    const fetchImplementation = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    );

    await expect(
      restorePreviousWorkflowArtifact({
        artifactName: "allure-history-state",
        currentRunId: "300",
        fetchImplementation,
        outputZip: path.join(root, "state.zip"),
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpi-workflow-artifact-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
