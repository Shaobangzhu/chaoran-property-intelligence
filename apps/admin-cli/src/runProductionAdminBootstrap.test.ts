import { describe, expect, it, vi } from "vitest";

import { UserEmailAlreadyExistsError } from "@chaoran-property-intelligence/application";
import { PasswordPolicyError } from "@chaoran-property-intelligence/domain";
import type { UserAccount } from "@chaoran-property-intelligence/domain";

import type { CreateAdminRuntime } from "./createAdmin.js";
import {
  runProductionAdminBootstrap,
  type ProductionAdminBootstrapDependencies,
} from "./runProductionAdminBootstrap.js";

const secretArn =
  "arn:aws:secretsmanager:us-west-2:111111111111:secret:cpi/production/admin-bootstrap/123-1-AbCd12";

describe("runProductionAdminBootstrap", () => {
  it("creates one production administrator without rerunning migrations", async () => {
    const output: string[] = [];
    const dependencies = createDependencies(validSecret());

    const exitCode = await runProductionAdminBootstrap(
      createRuntime(output),
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.readSecret).toHaveBeenCalledWith(secretArn);
    expect(dependencies.createAdmin).toHaveBeenCalledWith({
      environment: expect.objectContaining({
        CPI_DEPLOYMENT_STAGE: "production",
      }),
      input: {
        email: "Admin@Example.com",
        password: "a unique production password phrase",
      },
      runMigrations: false,
    });
    expect(output).toEqual([
      "Production administrator bootstrap completed.\n",
    ]);
  });

  it.each([
    ["DEV stage", { CPI_DEPLOYMENT_STAGE: "dev" }],
    ["missing confirmation", { CPI_ADMIN_BOOTSTRAP_CONFIRMATION: undefined }],
    ["foreign secret", { CPI_ADMIN_BOOTSTRAP_SECRET_ARN: "arn:foreign" }],
    [
      "DEV secret prefix",
      {
        CPI_ADMIN_BOOTSTRAP_SECRET_ARN:
          "arn:aws:secretsmanager:us-west-2:111111111111:secret:cpi/dev/admin-bootstrap/123-1-AbCd12",
      },
    ],
  ])("fails closed for %s", async (_label, override) => {
    const output: string[] = [];
    const dependencies = createDependencies(validSecret());

    const exitCode = await runProductionAdminBootstrap(
      createRuntime(output, override),
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.createAdmin).not.toHaveBeenCalled();
    expect(output).toEqual([
      "Production administrator bootstrap failed: BOUNDARY_REJECTED.\n",
    ]);
  });

  it.each([
    "not-json",
    "[]",
    JSON.stringify({ email: "admin@example.com" }),
    JSON.stringify({
      email: "admin@example.com",
      password: "secret-value",
      unexpected: true,
    }),
  ])("rejects malformed secret material without printing it", async (secret) => {
    const output: string[] = [];
    const dependencies = createDependencies(secret);

    const exitCode = await runProductionAdminBootstrap(
      createRuntime(output),
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.createAdmin).not.toHaveBeenCalled();
    expect(output.join(" ")).not.toContain(secret);
    expect(output).toEqual([
      "Production administrator bootstrap failed: SECRET_REJECTED.\n",
    ]);
  });

  it("does not expose credentials when persistence fails", async () => {
    const output: string[] = [];
    const dependencies = createDependencies(validSecret());
    vi.mocked(dependencies.createAdmin).mockRejectedValueOnce(
      new Error("database included secret-value"),
    );

    const exitCode = await runProductionAdminBootstrap(
      createRuntime(output),
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual([
      "Production administrator bootstrap failed: PERSISTENCE_FAILED.\n",
    ]);
    expect(output.join(" ")).not.toContain("secret-value");
  });

  it.each([
    [new UserEmailAlreadyExistsError(), "ACCOUNT_ALREADY_EXISTS"],
    [new PasswordPolicyError("blocked"), "ACCOUNT_POLICY_REJECTED"],
  ])("emits only bounded account failure code", async (error, code) => {
    const output: string[] = [];
    const dependencies = createDependencies(validSecret());
    vi.mocked(dependencies.createAdmin).mockRejectedValueOnce(error);

    const exitCode = await runProductionAdminBootstrap(
      createRuntime(output),
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual([
      `Production administrator bootstrap failed: ${code}.\n`,
    ]);
  });
});

function createRuntime(
  output: string[],
  override: Record<string, string | undefined> = {},
) {
  return {
    environment: {
      AWS_ACCOUNT_ID: "111111111111",
      AWS_REGION: "us-west-2",
      CPI_ADMIN_BOOTSTRAP_CONFIRMATION: "create-production-admin",
      CPI_ADMIN_BOOTSTRAP_SECRET_ARN: secretArn,
      CPI_DEPLOYMENT_STAGE: "production",
      PGDATABASE: "property_intelligence",
      PGHOST: "database.internal",
      PGPASSWORD: "database-password",
      PGPORT: "5432",
      PGSSLMODE: "verify-full",
      PGUSER: "property_worker",
      ...override,
    },
    stdout: { write: (message: string) => output.push(message) },
    stderr: { write: (message: string) => output.push(message) },
  };
}

function createDependencies(
  secret: string,
): ProductionAdminBootstrapDependencies {
  return {
    readSecret: vi.fn(async () => secret),
    createAdmin: vi.fn(async (_runtime: CreateAdminRuntime) => createUser()),
  };
}

function validSecret(): string {
  return JSON.stringify({
    email: "Admin@Example.com",
    password: "a unique production password phrase",
  });
}

function createUser(): UserAccount {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalizedEmail: "admin@example.com" as UserAccount["normalizedEmail"],
    role: "admin",
    status: "active",
    createdAt: "2026-08-31T19:00:00.000Z",
    updatedAt: "2026-08-31T19:00:00.000Z",
  };
}
