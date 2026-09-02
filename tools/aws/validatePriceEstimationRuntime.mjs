import { pathToFileURL } from "node:url";

export function validatePriceEstimationRuntime({
  budgetApproved,
  openAiEnabled,
  runtimeEnabled,
}) {
  const runtime = readBoolean("runtime enabled", runtimeEnabled);
  const openAi = readBoolean("OpenAI enabled", openAiEnabled);
  const budget = readBoolean("budget approved", budgetApproved);

  if (openAi && !runtime) {
    throw new Error(
      "Price Estimation OpenAI enhancement requires the runtime",
    );
  }
  if (runtime && !budget) {
    throw new Error(
      "Price Estimation runtime requires explicit NAT and provider budget approval",
    );
  }

  return Object.freeze({
    budgetApproved: budget,
    openAiEnabled: openAi,
    runtimeEnabled: runtime,
  });
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--budget-approved") {
      values.budgetApproved = value;
    } else if (name === "--openai-enabled") {
      values.openAiEnabled = value;
    } else if (name === "--runtime-enabled") {
      values.runtimeEnabled = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  for (const name of [
    "budgetApproved",
    "openAiEnabled",
    "runtimeEnabled",
  ]) {
    if (values[name] === undefined) {
      throw new Error(`--${toKebabCase(name)} is required`);
    }
  }
  return values;
}

function readBoolean(name, value) {
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function main() {
  const config = validatePriceEstimationRuntime(
    readArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    `Price Estimation runtime gate: runtime=${config.runtimeEnabled}, openai=${config.openAiEnabled}, budgetApproved=${config.budgetApproved}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
