import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const maxApiKeyLength = 4_096;

export async function verifyArcgisWebBuild({ apiKey, distDirectory }) {
  if (
    typeof apiKey !== "string" ||
    apiKey.length === 0 ||
    apiKey.length > maxApiKeyLength ||
    /\s/u.test(apiKey)
  ) {
    throw new Error("ArcGIS web build configuration was missing or invalid");
  }

  const assetsDirectory = path.join(distDirectory, "assets");
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const javaScriptFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(assetsDirectory, entry.name));

  if (javaScriptFiles.length === 0) {
    throw new Error("Web build did not contain JavaScript assets");
  }

  for (const javaScriptFile of javaScriptFiles) {
    const source = await readFile(javaScriptFile, "utf8");
    if (source.includes(apiKey)) {
      return;
    }
  }

  throw new Error("ArcGIS API key was not embedded in the web build");
}

function readArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--dist" || argv[1].length === 0) {
    throw new Error("Usage: verifyArcgisWebBuild.mjs --dist <directory>");
  }
  return { distDirectory: path.resolve(argv[1]) };
}

async function main() {
  const { distDirectory } = readArguments(process.argv.slice(2));
  await verifyArcgisWebBuild({
    apiKey: process.env.VITE_ARCGIS_API_KEY,
    distDirectory,
  });
  process.stdout.write("ArcGIS web build configuration verified.\n");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
