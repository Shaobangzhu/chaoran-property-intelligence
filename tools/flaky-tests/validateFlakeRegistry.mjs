import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  renderFlakePolicySummary,
  validateFlakeRegistry,
} from "./flakePolicy.mjs";

async function main() {
  const args = readArguments(process.argv.slice(2));
  const registry = JSON.parse(await readFile(args.registry, "utf8"));
  const validation = validateFlakeRegistry(registry);
  const summary = renderFlakePolicySummary(validation);
  await writeFile(args.output, summary, "utf8");
  if (args.githubSummary !== undefined) {
    await appendFile(args.githubSummary, summary, "utf8");
  }
  process.stdout.write(summary);
  if (validation.errors.length > 0) {
    process.exitCode = 2;
  }
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--registry") {
      values.registry = value;
    } else if (name === "--output") {
      values.output = value;
    } else if (name === "--github-summary") {
      values.githubSummary = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  if (values.registry === undefined || values.output === undefined) {
    throw new Error("--registry and --output are required");
  }
  return values;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
