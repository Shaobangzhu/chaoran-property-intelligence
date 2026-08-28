import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { validateFlakeRegistry } from "./flakePolicy.mjs";

const slowTestThresholdMs = 10_000;
const maximumReportedSlowTests = 20;

export function analyzePlaywrightResults(
  report,
  registry,
  { today } = {},
) {
  const policy = validateFlakeRegistry(registry, { today });
  const tests = collectTests(report);
  const testIds = new Set(tests.map((test) => test.testId));
  const quarantineByTestId = new Map(
    policy.activeQuarantines.map((quarantine) => [
      quarantine.testId,
      quarantine,
    ]),
  );
  const retryObservations = tests
    .filter(
      (test) =>
        test.status === "flaky" ||
        test.results.some((result) => Number(result.retry) > 0),
    )
    .map((test) => ({
      attempts: test.results.length,
      maxRetry: Math.max(
        0,
        ...test.results.map((result) => Number(result.retry) || 0),
      ),
      quarantine: quarantineByTestId.get(test.testId),
      status: test.status,
      testId: test.testId,
    }));
  const unexpectedRetries = retryObservations.filter(
    (observation) => observation.quarantine === undefined,
  );
  const quarantinedRetries = retryObservations.filter(
    (observation) => observation.quarantine !== undefined,
  );
  const staleQuarantines = policy.activeQuarantines.filter(
    (quarantine) => !testIds.has(quarantine.testId),
  );
  const allSlowTests = tests
    .filter((test) => test.durationMs >= slowTestThresholdMs)
    .sort((left, right) => right.durationMs - left.durationMs);

  return {
    noTestsDiscovered: tests.length === 0,
    policyErrors: policy.errors,
    quarantinedRetries,
    retryObservations,
    slowTestOverflow: Math.max(
      0,
      allSlowTests.length - maximumReportedSlowTests,
    ),
    slowTests: allSlowTests.slice(0, maximumReportedSlowTests),
    staleQuarantines,
    testCount: tests.length,
    unexpectedRetries,
  };
}

export function createPlaywrightTestId({
  file,
  projectName,
  specTitle,
  suiteTitles,
}) {
  const title = [...suiteTitles, specTitle]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" > ");
  return `${projectName}::${file.replaceAll("\\", "/")}::${title}`;
}

export function renderFlakeAnalysis(analysis) {
  const lines = [
    "## Retry And Flake Analysis",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Tests discovered | ${analysis.testCount} |`,
    `| Retry observations | ${analysis.retryObservations.length} |`,
    `| Unexpected retries | ${analysis.unexpectedRetries.length} |`,
    `| Quarantined retries | ${analysis.quarantinedRetries.length} |`,
    `| Stale quarantines | ${analysis.staleQuarantines.length} |`,
    `| Slow tests (>=10s) | ${analysis.slowTests.length + analysis.slowTestOverflow} |`,
    `| Policy errors | ${analysis.policyErrors.length} |`,
    "",
  ];
  if (analysis.retryObservations.length === 0) {
    lines.push("No test used a retry.", "");
  } else {
    lines.push(
      "| Test ID | Attempts | Final status | Quarantine |",
      "| --- | ---: | --- | --- |",
    );
    for (const observation of analysis.retryObservations) {
      const quarantine = observation.quarantine;
      lines.push(
        `| ${escapeTable(observation.testId)} | ${observation.attempts} | ${observation.status} | ${quarantine === undefined ? "none" : `${escapeTable(quarantine.owner)} until ${quarantine.expiresOn}`} |`,
      );
    }
    lines.push("");
  }
  if (analysis.noTestsDiscovered) {
    lines.push("**No tests were discovered; the nightly gate fails closed.**", "");
  }
  if (analysis.staleQuarantines.length > 0) {
    lines.push("### Stale Quarantines", "");
    for (const quarantine of analysis.staleQuarantines) {
      lines.push(`- ${escapeMarkdown(quarantine.testId)}`);
    }
    lines.push("");
  }
  if (analysis.slowTests.length > 0) {
    lines.push(
      "### Slow Tests",
      "",
      "| Test ID | Longest attempt |",
      "| --- | ---: |",
    );
    for (const test of analysis.slowTests) {
      lines.push(`| ${escapeTable(test.testId)} | ${test.durationMs}ms |`);
    }
    if (analysis.slowTestOverflow > 0) {
      lines.push(
        `| Additional tests omitted | ${analysis.slowTestOverflow} |`,
      );
    }
    lines.push("");
  }
  if (analysis.policyErrors.length > 0) {
    lines.push("### Policy Errors", "");
    for (const error of analysis.policyErrors) {
      lines.push(`- ${escapeMarkdown(error)}`);
    }
    lines.push("");
  }
  lines.push(
    "A retry is diagnostic evidence, not a clean first-attempt pass. Unexpected retry usage fails the nightly gate.",
    "",
  );
  return lines.join("\n");
}

function collectTests(report) {
  if (!isRecord(report) || !Array.isArray(report.suites)) {
    throw new Error("Playwright report must contain a suites array");
  }
  const tests = [];
  for (const suite of report.suites) {
    visitSuite(suite, [], tests);
  }
  return tests;
}

function visitSuite(suite, parentTitles, tests) {
  if (!isRecord(suite)) {
    throw new Error("Playwright suite must be an object");
  }
  const suiteTitles =
    typeof suite.title === "string" && suite.title.length > 0
      ? [...parentTitles, suite.title]
      : parentTitles;
  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      if (!isRecord(spec) || !Array.isArray(spec.tests)) {
        throw new Error("Playwright spec must contain a tests array");
      }
      for (const test of spec.tests) {
        if (!isRecord(test) || !Array.isArray(test.results)) {
          throw new Error("Playwright test must contain a results array");
        }
        tests.push({
          durationMs: Math.max(
            0,
            ...test.results.map((result) => Number(result.duration) || 0),
          ),
          results: test.results,
          status: String(test.status ?? "unknown"),
          testId: createPlaywrightTestId({
            file: String(spec.file ?? suite.file ?? "unknown-file"),
            projectName: String(test.projectName ?? "unknown-project"),
            specTitle: String(spec.title ?? "unknown-test"),
            suiteTitles,
          }),
        });
      }
    }
  }
  if (Array.isArray(suite.suites)) {
    for (const childSuite of suite.suites) {
      visitSuite(childSuite, suiteTitles, tests);
    }
  }
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const [report, registry] = await Promise.all([
    readJson(args.results),
    readJson(args.registry),
  ]);
  const analysis = analyzePlaywrightResults(report, registry);
  const markdown = renderFlakeAnalysis(analysis);
  const boundedJson = {
    policyErrors: analysis.policyErrors,
    noTestsDiscovered: analysis.noTestsDiscovered,
    quarantinedRetries: analysis.quarantinedRetries.map(boundedObservation),
    retryObservations: analysis.retryObservations.map(boundedObservation),
    schemaVersion: 1,
    slowTestOverflow: analysis.slowTestOverflow,
    slowTests: analysis.slowTests.map((test) => ({
      durationMs: test.durationMs,
      status: test.status,
      testId: test.testId,
    })),
    staleQuarantines: analysis.staleQuarantines,
    testCount: analysis.testCount,
    unexpectedRetries: analysis.unexpectedRetries.map(boundedObservation),
  };
  await Promise.all([
    writeFile(args.outputMarkdown, markdown, "utf8"),
    writeFile(
      args.outputJson,
      `${JSON.stringify(boundedJson, undefined, 2)}\n`,
      "utf8",
    ),
  ]);
  if (args.githubOutput !== undefined) {
    await appendFile(
      args.githubOutput,
      [
        `retry_count=${analysis.retryObservations.length}`,
        `unexpected_retry_count=${analysis.unexpectedRetries.length}`,
        `quarantined_retry_count=${analysis.quarantinedRetries.length}`,
        `stale_quarantine_count=${analysis.staleQuarantines.length}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  process.stdout.write(markdown);
  if (
    args.failOnUnexpected &&
    (analysis.unexpectedRetries.length > 0 ||
      analysis.staleQuarantines.length > 0 ||
      analysis.policyErrors.length > 0 ||
      analysis.noTestsDiscovered)
  ) {
    process.exitCode = 2;
  }
}

function boundedObservation(observation) {
  return {
    attempts: observation.attempts,
    maxRetry: observation.maxRetry,
    quarantine:
      observation.quarantine === undefined
        ? undefined
        : {
            expiresOn: observation.quarantine.expiresOn,
            owner: observation.quarantine.owner,
            remediationUrl: observation.quarantine.remediationUrl,
          },
    status: observation.status,
    testId: observation.testId,
  };
}

function readArguments(argv) {
  const values = { failOnUnexpected: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--fail-on-unexpected") {
      values.failOnUnexpected = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--results") {
      values.results = value;
    } else if (name === "--registry") {
      values.registry = value;
    } else if (name === "--output-markdown") {
      values.outputMarkdown = value;
    } else if (name === "--output-json") {
      values.outputJson = value;
    } else if (name === "--github-output") {
      values.githubOutput = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
    index += 1;
  }
  for (const required of [
    "results",
    "registry",
    "outputMarkdown",
    "outputJson",
  ]) {
    if (values[required] === undefined) {
      throw new Error(`--${toKebabCase(required)} is required`);
    }
  }
  return values;
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeMarkdown(value) {
  return value.replaceAll("`", "\\`");
}

function escapeTable(value) {
  return escapeMarkdown(value).replaceAll("|", "\\|");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
