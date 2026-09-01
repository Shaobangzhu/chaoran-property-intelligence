import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyArcgisWebBuild } from "./verifyArcgisWebBuild.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("verifyArcgisWebBuild", () => {
  it("accepts a build containing the configured ArcGIS API key", async () => {
    const distDirectory = await createBuild(
      'const key = "test.arcgis-key_123";',
    );

    await expect(
      verifyArcgisWebBuild({
        apiKey: "test.arcgis-key_123",
        distDirectory,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([undefined, "", "contains whitespace"])(
    "rejects an invalid build configuration: %s",
    async (apiKey) => {
      const distDirectory = await createBuild("const key = undefined;");

      await expect(
        verifyArcgisWebBuild({ apiKey, distDirectory }),
      ).rejects.toThrow("ArcGIS web build configuration was missing or invalid");
    },
  );

  it("rejects a build that omitted the configured ArcGIS API key", async () => {
    const distDirectory = await createBuild("const key = undefined;");

    await expect(
      verifyArcgisWebBuild({
        apiKey: "test.arcgis-key_123",
        distDirectory,
      }),
    ).rejects.toThrow("ArcGIS API key was not embedded in the web build");
  });
});

async function createBuild(source) {
  const directory = await mkdtemp(path.join(tmpdir(), "cpi-arcgis-build-"));
  temporaryDirectories.push(directory);
  const assetsDirectory = path.join(directory, "assets");
  await mkdir(assetsDirectory);
  await writeFile(path.join(assetsDirectory, "index.js"), source, "utf8");
  return directory;
}
