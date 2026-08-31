import { UserEmailAlreadyExistsError } from "@chaoran-property-intelligence/application";
import {
  InvalidUserEmailError,
  PasswordPolicyError,
  type UserAccount,
} from "@chaoran-property-intelligence/domain";

import type { CreateAdminRuntime } from "./createAdmin.js";
import type { TextWriter } from "./runCreateAdminCli.js";

export interface ProductionAdminBootstrapRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  stdout: TextWriter;
  stderr: TextWriter;
}

export interface ProductionAdminBootstrapDependencies {
  readSecret(secretArn: string): Promise<string>;
  createAdmin(runtime: CreateAdminRuntime): Promise<UserAccount>;
}

const expectedConfirmation = "create-production-admin";
const secretNamePrefix = "cpi/production/admin-bootstrap/";

export async function runProductionAdminBootstrap(
  runtime: ProductionAdminBootstrapRuntime,
  dependencies: ProductionAdminBootstrapDependencies,
): Promise<number> {
  let secretArn: string;
  try {
    validateExecutionBoundary(runtime.environment);
    secretArn = readSecretArn(runtime.environment);
  } catch {
    return writeFailure(runtime, "BOUNDARY_REJECTED");
  }

  let rawSecret: string;
  try {
    rawSecret = await dependencies.readSecret(secretArn);
  } catch {
    return writeFailure(runtime, "SECRET_UNAVAILABLE");
  }

  let secret: { email: string; password: string };
  try {
    secret = parseBootstrapSecret(rawSecret);
  } catch {
    return writeFailure(runtime, "SECRET_REJECTED");
  }

  try {
    await dependencies.createAdmin({
      environment: runtime.environment,
      input: secret,
      runMigrations: false,
    });
    runtime.stdout.write("Production administrator bootstrap completed.\n");
    return 0;
  } catch (error) {
    if (error instanceof UserEmailAlreadyExistsError) {
      return writeFailure(runtime, "ACCOUNT_ALREADY_EXISTS");
    }
    if (
      error instanceof InvalidUserEmailError ||
      error instanceof PasswordPolicyError
    ) {
      return writeFailure(runtime, "ACCOUNT_POLICY_REJECTED");
    }
    return writeFailure(runtime, "PERSISTENCE_FAILED");
  }
}

function writeFailure(
  runtime: ProductionAdminBootstrapRuntime,
  code:
    | "ACCOUNT_ALREADY_EXISTS"
    | "ACCOUNT_POLICY_REJECTED"
    | "BOUNDARY_REJECTED"
    | "PERSISTENCE_FAILED"
    | "SECRET_REJECTED"
    | "SECRET_UNAVAILABLE",
): 1 {
  runtime.stderr.write(
    `Production administrator bootstrap failed: ${code}.\n`,
  );
  return 1;
}

function validateExecutionBoundary(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.CPI_DEPLOYMENT_STAGE !== "production") {
    throw new Error("Production deployment stage was not confirmed");
  }
  if (environment.CPI_ADMIN_BOOTSTRAP_CONFIRMATION !== expectedConfirmation) {
    throw new Error("Production administrator bootstrap was not confirmed");
  }
}

function readSecretArn(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const secretArn = environment.CPI_ADMIN_BOOTSTRAP_SECRET_ARN;
  const region = environment.AWS_REGION;
  const accountId = environment.AWS_ACCOUNT_ID;
  if (
    secretArn === undefined ||
    region === undefined ||
    accountId === undefined ||
    !/^\d{12}$/u.test(accountId)
  ) {
    throw new Error(
      "Production administrator bootstrap secret identity was invalid",
    );
  }
  const expectedPrefix =
    `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretNamePrefix}`;
  if (!secretArn.startsWith(expectedPrefix)) {
    throw new Error(
      "Production administrator bootstrap secret identity was invalid",
    );
  }
  const secretIdentity = secretArn.slice(expectedPrefix.length);
  if (!/^[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u.test(secretIdentity)) {
    throw new Error(
      "Production administrator bootstrap secret identity was invalid",
    );
  }
  return secretArn;
}

function parseBootstrapSecret(value: string): {
  email: string;
  password: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Production administrator bootstrap secret was invalid");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Production administrator bootstrap secret was invalid");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "email,password" ||
    typeof record.email !== "string" ||
    typeof record.password !== "string" ||
    record.email.length === 0 ||
    record.password.length === 0
  ) {
    throw new Error("Production administrator bootstrap secret was invalid");
  }
  return { email: record.email, password: record.password };
}
