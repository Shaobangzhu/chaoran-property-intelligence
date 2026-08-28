import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createReleaseManifest({ gitSha, stage }) {
  if (!/^[a-f0-9]{40}$/u.test(gitSha)) {
    throw new Error("gitSha must be a lowercase 40-character Git SHA");
  }
  if (stage !== "dev" && stage !== "production") {
    throw new Error("stage must be dev or production");
  }
  return { gitSha, stage };
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const manifest = createReleaseManifest({
    gitSha: args.sha,
    stage: args.stage,
  });
  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(
    args.output,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
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
    if (name === "--sha") {
      values.sha = value;
    } else if (name === "--stage") {
      values.stage = value;
    } else if (name === "--output") {
      values.output = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  for (const key of ["sha", "stage", "output"]) {
    if (values[key] === undefined) {
      throw new Error(`--${key} is required`);
    }
  }
  return values;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
