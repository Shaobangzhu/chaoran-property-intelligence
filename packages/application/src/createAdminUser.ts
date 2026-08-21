import {
  normalizeUserEmail,
  validateNewPassword,
  type UserAccount,
} from "@chaoran-property-intelligence/domain";

import type { PasswordHasherPort } from "./passwordHasher.js";
import type { UserRepositoryPort } from "./userRepository.js";

export interface CreateAdminUserInput {
  email: string;
  password: string;
}

export interface CreateAdminUserOptions {
  repository: UserRepositoryPort;
  passwordHasher: PasswordHasherPort;
}

export class CreateAdminUser {
  private readonly repository: UserRepositoryPort;
  private readonly passwordHasher: PasswordHasherPort;

  constructor(options: CreateAdminUserOptions) {
    this.repository = options.repository;
    this.passwordHasher = options.passwordHasher;
  }

  async execute(input: CreateAdminUserInput): Promise<UserAccount> {
    const normalizedEmail = normalizeUserEmail(input.email);
    const normalizedPassword = validateNewPassword(input.password, {
      normalizedEmail,
    });
    const passwordHash = await this.passwordHasher.hash(normalizedPassword);

    return this.repository.createUser({
      normalizedEmail,
      passwordHash,
      role: "admin",
      status: "active",
    });
  }
}
