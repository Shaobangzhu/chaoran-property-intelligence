import { describe, expect, it, vi } from "vitest";

import {
  UserEmailAlreadyExistsError,
  type CreateAdminUserInput,
} from "@chaoran-property-intelligence/application";
import type { NormalizedUserEmail, UserAccount } from "@chaoran-property-intelligence/domain";

import {
  runCreateAdminCli,
  type PasswordPromptOptions,
} from "./runCreateAdminCli.js";

describe("runCreateAdminCli", () => {
  it("prompts twice with masking and creates the administrator", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const prompts: PasswordPromptOptions[] = [];
    const answers = ["a unique password phrase", "a unique password phrase"];
    const createAdmin = vi.fn(async () => createUser());

    const exitCode = await runCreateAdminCli(
      {
        args: ["--email", "Admin@Example.com"],
        stdout,
        stderr,
      },
      {
        promptPassword: async (options) => {
          prompts.push(options);
          return answers.shift() ?? "";
        },
        createAdmin,
      },
    );

    expect(exitCode).toBe(0);
    expect(prompts).toEqual([
      { message: "Password:", mask: true },
      { message: "Confirm password:", mask: true },
    ]);
    expect(createAdmin).toHaveBeenCalledWith({
      email: "Admin@Example.com",
      password: "a unique password phrase",
    });
    expect(stdout.output).toBe(
      "Administrator created for admin@example.com.\n",
    );
    expect(stderr.output).toBe("");
    expect(`${stdout.output}${stderr.output}`).not.toContain(
      "a unique password phrase",
    );
  });

  it("rejects mismatched confirmation without creating a user", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const answers = ["a unique password phrase", "a different phrase here"];
    const createAdmin = vi.fn(async () => createUser());

    const exitCode = await runCreateAdminCli(
      {
        args: ["--email", "admin@example.com"],
        stdout,
        stderr,
      },
      {
        promptPassword: async () => answers.shift() ?? "",
        createAdmin,
      },
    );

    expect(exitCode).toBe(1);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe("Passwords do not match.\n");
  });

  it("prints a bounded duplicate-email error", async () => {
    const stderr = new MemoryWriter();

    const exitCode = await runCreateAdminCli(
      {
        args: ["--email", "admin@example.com"],
        stdout: new MemoryWriter(),
        stderr,
      },
      {
        promptPassword: async () => "a unique password phrase",
        createAdmin: async () => {
          throw new UserEmailAlreadyExistsError();
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr.output).toBe("A user with this email already exists\n");
  });

  it("does not expose unexpected internal errors", async () => {
    const stderr = new MemoryWriter();

    const exitCode = await runCreateAdminCli(
      {
        args: ["--email", "admin@example.com"],
        stdout: new MemoryWriter(),
        stderr,
      },
      {
        promptPassword: async () => "a unique password phrase",
        createAdmin: async () => {
          throw new Error("database-internal-credential-marker");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr.output).toBe("Administrator creation failed.\n");
    expect(stderr.output).not.toContain("credential-marker");
  });

  it("requires exactly one explicit email argument", async () => {
    const stderr = new MemoryWriter();
    const promptPassword = vi.fn(async () => "unused password value");

    const exitCode = await runCreateAdminCli(
      {
        args: [],
        stdout: new MemoryWriter(),
        stderr,
      },
      {
        promptPassword,
        createAdmin: async (_input: CreateAdminUserInput) => createUser(),
      },
    );

    expect(exitCode).toBe(1);
    expect(promptPassword).not.toHaveBeenCalled();
    expect(stderr.output).toBe(
      "Usage: pnpm user:create-admin --email <email>\n",
    );
  });
});

class MemoryWriter {
  output = "";

  write(message: string): void {
    this.output += message;
  }
}

function createUser(): UserAccount {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalizedEmail: "admin@example.com" as NormalizedUserEmail,
    role: "admin",
    status: "active",
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-20T19:00:00.000Z",
  };
}
