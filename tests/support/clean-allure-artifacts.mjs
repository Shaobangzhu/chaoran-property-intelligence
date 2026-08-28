import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shouldAppend = process.env.CPI_APPEND_ALLURE_RESULTS === "true";

if (!shouldAppend) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );

  await Promise.all([
    removeGeneratedDirectory(repositoryRoot, "allure-results"),
    removeGeneratedDirectory(repositoryRoot, "allure-report"),
  ]);
}

async function removeGeneratedDirectory(
  repositoryRoot,
  directoryName,
) {
  await rm(path.join(repositoryRoot, directoryName), {
    force: true,
    recursive: true,
  });
}
