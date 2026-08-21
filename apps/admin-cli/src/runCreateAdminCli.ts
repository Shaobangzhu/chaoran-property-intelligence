import {
  UserEmailAlreadyExistsError,
  type CreateAdminUserInput,
} from "@chaoran-property-intelligence/application";
import {
  InvalidUserEmailError,
  PasswordPolicyError,
  type UserAccount,
} from "@chaoran-property-intelligence/domain";

export interface TextWriter {
  write(message: string): void;
}

export interface CreateAdminCliRuntime {
  args: string[];
  stdout: TextWriter;
  stderr: TextWriter;
}

export interface PasswordPromptOptions {
  message: string;
  mask: true;
}

export interface CreateAdminCliDependencies {
  promptPassword(options: PasswordPromptOptions): Promise<string>;
  createAdmin(input: CreateAdminUserInput): Promise<UserAccount>;
}

const usageMessage =
  "Usage: pnpm user:create-admin --email <email>\n";

export async function runCreateAdminCli(
  runtime: CreateAdminCliRuntime,
  dependencies: CreateAdminCliDependencies,
): Promise<number> {
  const email = readEmailArgument(runtime.args);
  if (email === null) {
    runtime.stderr.write(usageMessage);
    return 1;
  }

  try {
    const password = await dependencies.promptPassword({
      message: "Password:",
      mask: true,
    });
    const confirmation = await dependencies.promptPassword({
      message: "Confirm password:",
      mask: true,
    });

    if (password !== confirmation) {
      runtime.stderr.write("Passwords do not match.\n");
      return 1;
    }

    const user = await dependencies.createAdmin({ email, password });
    runtime.stdout.write(
      `Administrator created for ${user.normalizedEmail}.\n`,
    );
    return 0;
  } catch (error) {
    if (isSafeCliError(error)) {
      runtime.stderr.write(`${error.message}\n`);
    } else {
      runtime.stderr.write("Administrator creation failed.\n");
    }
    return 1;
  }
}

function readEmailArgument(args: string[]): string | null {
  if (
    args.length !== 2 ||
    args[0] !== "--email" ||
    args[1] === undefined ||
    args[1].trim().length === 0
  ) {
    return null;
  }

  return args[1];
}

function isSafeCliError(
  error: unknown,
): error is
  | InvalidUserEmailError
  | PasswordPolicyError
  | UserEmailAlreadyExistsError {
  return (
    error instanceof InvalidUserEmailError ||
    error instanceof PasswordPolicyError ||
    error instanceof UserEmailAlreadyExistsError
  );
}
