import type {
  NormalizedUserEmail,
  UserAccount,
  UserRole,
  UserStatus,
} from "@chaoran-property-intelligence/domain";

export interface CreateUserInput {
  normalizedEmail: NormalizedUserEmail;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
}

export interface UserAuthenticationRecord extends UserAccount {
  passwordHash: string;
}

export interface UserRepositoryPort {
  createUser(input: CreateUserInput): Promise<UserAccount>;
  findById(id: string): Promise<UserAccount | null>;
  findByNormalizedEmail(
    normalizedEmail: NormalizedUserEmail,
  ): Promise<UserAuthenticationRecord | null>;
}

export class UserEmailAlreadyExistsError extends Error {
  constructor() {
    super("A user with this email already exists");
    this.name = "UserEmailAlreadyExistsError";
  }
}
