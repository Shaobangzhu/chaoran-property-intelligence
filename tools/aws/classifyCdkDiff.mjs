import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const resourceLine =
  /^\[([+~-])\]\s+((?:AWS|Custom)::\S+)\s+(.+?)\s+(\S+?)(?:\s+(replace))?$/u;

export function classifyCdkDiff(rawDiff) {
  const changes = {
    create: [],
    update: [],
    replace: [],
    delete: [],
  };
  let stack = "unknown-stack";

  for (const originalLine of rawDiff.split(/\r?\n/u)) {
    const line = originalLine.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
    const stackMatch = /^Stack\s+(.+)$/u.exec(line);
    if (stackMatch !== null) {
      stack = stackMatch[1].trim();
      continue;
    }

    const match = resourceLine.exec(line);
    if (match === null) {
      continue;
    }

    const [, operation, resourceType, constructPath, logicalId, replacement] =
      match;
    const change = { constructPath, logicalId, resourceType, stack };
    if (operation === "+") {
      changes.create.push(change);
    } else if (operation === "-") {
      changes.delete.push(change);
    } else if (replacement === "replace") {
      changes.replace.push(change);
    } else {
      changes.update.push(change);
    }
  }

  return changes;
}

export function renderCdkDiffSummary(changes) {
  const sections = [
    ["CREATE", changes.create],
    ["UPDATE", changes.update],
    ["REPLACE", changes.replace],
    ["DELETE", changes.delete],
  ];
  const lines = ["# AWS DEV CDK diff classification", ""];

  for (const [heading, entries] of sections) {
    lines.push(`## ${heading} (${entries.length})`, "");
    if (entries.length === 0) {
      lines.push("None", "");
      continue;
    }
    for (const entry of entries) {
      lines.push(
        `- \`${escapeMarkdown(entry.stack)}\` / \`${escapeMarkdown(entry.resourceType)}\` / \`${escapeMarkdown(entry.logicalId)}\`: ${escapeMarkdown(entry.constructPath)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const rawDiff = await readFile(args.input, "utf8");
  const changes = classifyCdkDiff(rawDiff);
  const summary = renderCdkDiffSummary(changes);

  await writeFile(args.output, summary, "utf8");
  if (args.githubOutput !== undefined) {
    await appendFile(
      args.githubOutput,
      [
        `create_count=${changes.create.length}`,
        `update_count=${changes.update.length}`,
        `replace_count=${changes.replace.length}`,
        `delete_count=${changes.delete.length}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  process.stdout.write(summary);
  if (args.failOnDelete && changes.delete.length > 0) {
    process.stderr.write("DELETE changes require a separately reviewed change.\n");
    process.exitCode = 2;
  }
}

function readArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fail-on-delete") {
      options.failOnDelete = true;
      continue;
    }
    if (["--input", "--output", "--github-output"].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2).replace("-output", "Output")] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.input === undefined || options.output === undefined) {
    throw new Error("--input and --output are required");
  }
  return options;
}

function escapeMarkdown(value) {
  return value.replaceAll("`", "\\`");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
