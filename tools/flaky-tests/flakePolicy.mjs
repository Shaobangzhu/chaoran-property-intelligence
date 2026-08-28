const rootKeys = [
  "maximumQuarantineDays",
  "quarantines",
  "schemaVersion",
];
const quarantineKeys = [
  "evidenceUrl",
  "expiresOn",
  "introducedOn",
  "owner",
  "reason",
  "remediationUrl",
  "testId",
];

export function validateFlakeRegistry(
  registry,
  { today = currentUtcDate() } = {},
) {
  const errors = [];
  if (!isRecord(registry)) {
    return { activeQuarantines: [], errors: ["registry must be an object"] };
  }

  validateExactKeys(registry, rootKeys, "registry", errors);
  if (registry.schemaVersion !== 1) {
    errors.push("registry.schemaVersion must be 1");
  }
  if (registry.maximumQuarantineDays !== 30) {
    errors.push("registry.maximumQuarantineDays must be 30");
  }
  if (!Array.isArray(registry.quarantines)) {
    errors.push("registry.quarantines must be an array");
    return { activeQuarantines: [], errors };
  }

  const seenTestIds = new Set();
  const activeQuarantines = [];
  for (const [index, quarantine] of registry.quarantines.entries()) {
    const path = `registry.quarantines[${index}]`;
    if (!isRecord(quarantine)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    validateExactKeys(quarantine, quarantineKeys, path, errors);

    const testId = readBoundedString(
      quarantine.testId,
      `${path}.testId`,
      1,
      500,
      errors,
    );
    const owner = readBoundedString(
      quarantine.owner,
      `${path}.owner`,
      2,
      100,
      errors,
    );
    const reason = readBoundedString(
      quarantine.reason,
      `${path}.reason`,
      20,
      500,
      errors,
    );
    if (owner !== undefined && !/^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(owner)) {
      errors.push(`${path}.owner must be a GitHub handle such as @owner`);
    }
    validateHttpsUrl(quarantine.evidenceUrl, `${path}.evidenceUrl`, errors);
    validateHttpsUrl(
      quarantine.remediationUrl,
      `${path}.remediationUrl`,
      errors,
    );

    const introducedOn = parseDate(
      quarantine.introducedOn,
      `${path}.introducedOn`,
      errors,
    );
    const expiresOn = parseDate(
      quarantine.expiresOn,
      `${path}.expiresOn`,
      errors,
    );
    const todayDate = parseDate(today, "today", errors);
    if (
      introducedOn !== undefined &&
      expiresOn !== undefined &&
      expiresOn <= introducedOn
    ) {
      errors.push(`${path}.expiresOn must be after introducedOn`);
    }
    if (
      introducedOn !== undefined &&
      expiresOn !== undefined &&
      daysBetween(introducedOn, expiresOn) > 30
    ) {
      errors.push(`${path} may not be quarantined for more than 30 days`);
    }
    if (
      introducedOn !== undefined &&
      todayDate !== undefined &&
      introducedOn > todayDate
    ) {
      errors.push(`${path}.introducedOn may not be in the future`);
    }
    if (
      expiresOn !== undefined &&
      todayDate !== undefined &&
      expiresOn <= todayDate
    ) {
      errors.push(`${path} expired on ${quarantine.expiresOn}`);
    }

    if (testId !== undefined) {
      if (seenTestIds.has(testId)) {
        errors.push(`${path}.testId duplicates ${testId}`);
      }
      seenTestIds.add(testId);
    }
    if (
      testId !== undefined &&
      owner !== undefined &&
      reason !== undefined &&
      introducedOn !== undefined &&
      expiresOn !== undefined
    ) {
      activeQuarantines.push(quarantine);
    }
  }

  return { activeQuarantines, errors };
}

export function renderFlakePolicySummary(validation) {
  const lines = [
    "## Flaky-Test Quarantine Policy",
    "",
    `Active quarantines: **${validation.activeQuarantines.length}**`,
    `Policy errors: **${validation.errors.length}**`,
    "",
  ];
  if (validation.errors.length > 0) {
    lines.push("### Policy Errors", "");
    for (const error of validation.errors) {
      lines.push(`- ${escapeMarkdown(error)}`);
    }
    lines.push("");
  }
  if (validation.activeQuarantines.length === 0) {
    lines.push("No tests are quarantined.", "");
  } else {
    lines.push("| Test ID | Owner | Expires | Remediation |", "| --- | --- | --- | --- |");
    for (const quarantine of validation.activeQuarantines) {
      lines.push(
        `| ${escapeTable(quarantine.testId)} | ${escapeTable(quarantine.owner)} | ${quarantine.expiresOn} | [tracking issue](${quarantine.remediationUrl}) |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function validateExactKeys(value, expectedKeys, path, errors) {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  for (const key of actualKeys) {
    if (!expected.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
  for (const key of expected) {
    if (!actualKeys.includes(key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
}

function readBoundedString(value, path, minimum, maximum, errors) {
  if (typeof value !== "string" || value.trim() !== value) {
    errors.push(`${path} must be a trimmed string`);
    return undefined;
  }
  if (value.length < minimum || value.length > maximum || /[\r\n]/u.test(value)) {
    errors.push(`${path} must contain ${minimum}-${maximum} characters on one line`);
    return undefined;
  }
  return value;
}

function validateHttpsUrl(value, path, errors) {
  if (typeof value !== "string") {
    errors.push(`${path} must be an HTTPS URL`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("invalid URL");
    }
  } catch {
    errors.push(`${path} must be an HTTPS URL without credentials`);
  }
}

function parseDate(value, path, errors) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    errors.push(`${path} must use YYYY-MM-DD`);
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${path} must be a real calendar date`);
    return undefined;
  }
  return parsed;
}

function daysBetween(start, end) {
  return (end.valueOf() - start.valueOf()) / 86_400_000;
}

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeMarkdown(value) {
  return value.replaceAll("`", "\\`");
}

function escapeTable(value) {
  return value.replaceAll("|", "\\|");
}
