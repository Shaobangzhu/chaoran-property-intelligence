import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const gitShaPattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export function createProductionAdminBootstrapApproval({ commit, rawPlan }) {
  if (!gitShaPattern.test(commit)) {
    throw new Error("commit must be a lowercase 40-character Git SHA");
  }
  const plan = validatePlan(JSON.parse(rawPlan));
  const canonicalPlan = `${JSON.stringify(sortValue(plan))}\n`;
  const planSha256 = sha256(canonicalPlan);
  const approvalDigest = sha256(
    JSON.stringify({
      commit,
      operation: "create-production-admin",
      planSha256,
      schemaVersion: 1,
      stage: "production",
    }),
  );
  return {
    approvalDigest,
    commit,
    operation: "create-production-admin",
    planSha256,
    schemaVersion: 1,
    stage: "production",
  };
}

export function renderProductionAdminBootstrapApproval(approval) {
  return [
    "# Production Administrator Bootstrap Approval",
    "",
    `Commit: \`${approval.commit}\``,
    "",
    `Sanitized plan SHA-256: \`${approval.planSha256}\``,
    "",
    `Approval digest: \`${approval.approvalDigest}\``,
    "",
    "A create run must recompute this exact digest against unchanged production runtime state.",
    "",
  ].join("\n");
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const rawPlan = await readFile(args.plan, "utf8");
  const approval = createProductionAdminBootstrapApproval({
    commit: args.commit,
    rawPlan,
  });
  await writeFile(
    args.output,
    `${JSON.stringify(approval, undefined, 2)}\n`,
    "utf8",
  );
  if (args.githubOutput !== undefined) {
    await appendFile(
      args.githubOutput,
      `approval_digest=${approval.approvalDigest}\n`,
      "utf8",
    );
  }
  process.stdout.write(renderProductionAdminBootstrapApproval(approval));
  if (
    args.expectedDigest !== undefined &&
    args.expectedDigest !== approval.approvalDigest
  ) {
    process.stderr.write(
      "Approved production administrator plan does not match this commit and current runtime state.\n",
    );
    process.exitCode = 2;
  }
}

function validatePlan(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("plan must be an object");
  }
  const requiredKeys = [
    "accountId",
    "adminEmailSha256",
    "clusterArn",
    "containerImage",
    "containerImageDigest",
    "containerName",
    "region",
    "scheduleStates",
    "schemaVersion",
    "securityGroupId",
    "stage",
    "subnetIds",
    "taskDefinitionArn",
  ];
  if (Object.keys(value).sort().join(",") !== requiredKeys.sort().join(",")) {
    throw new Error("plan keys did not match the bounded schema");
  }
  if (!/^\d{12}$/u.test(value.accountId)) {
    throw new Error("plan accountId was invalid");
  }
  if (!sha256Pattern.test(value.adminEmailSha256)) {
    throw new Error("plan adminEmailSha256 was invalid");
  }
  for (const key of [
    "clusterArn",
    "containerImage",
    "containerName",
    "region",
    "securityGroupId",
    "taskDefinitionArn",
  ]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`plan ${key} was invalid`);
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(value.containerImageDigest)) {
    throw new Error("plan containerImageDigest was invalid");
  }
  if (value.schemaVersion !== 1 || value.stage !== "production") {
    throw new Error("plan stage or schemaVersion was invalid");
  }
  if (
    !Array.isArray(value.subnetIds) ||
    value.subnetIds.length < 2 ||
    value.subnetIds.some(
      (subnetId) =>
        typeof subnetId !== "string" || !/^subnet-[a-f0-9]+$/u.test(subnetId),
    )
  ) {
    throw new Error("plan subnetIds were invalid");
  }
  if (
    typeof value.scheduleStates !== "object" ||
    value.scheduleStates === null ||
    Array.isArray(value.scheduleStates) ||
    value.scheduleStates.daily !== "DISABLED" ||
    value.scheduleStates.weekly !== "DISABLED"
  ) {
    throw new Error("Production schedules must be disabled");
  }
  return value;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--commit") {
      values.commit = value;
    } else if (name === "--expected-digest") {
      values.expectedDigest = value;
    } else if (name === "--github-output") {
      values.githubOutput = value;
    } else if (name === "--output") {
      values.output = value;
    } else if (name === "--plan") {
      values.plan = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  for (const key of ["commit", "output", "plan"]) {
    if (values[key] === undefined) {
      throw new Error(`--${key} is required`);
    }
  }
  if (
    values.expectedDigest !== undefined &&
    !sha256Pattern.test(values.expectedDigest)
  ) {
    throw new Error("--expected-digest must be a lowercase SHA-256 digest");
  }
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
