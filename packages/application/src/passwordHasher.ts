import type { NormalizedPassword } from "@chaoran-property-intelligence/domain";

export interface PasswordHasherPort {
  hash(password: NormalizedPassword): Promise<string>;
  verify(password: NormalizedPassword, passwordHash: string): Promise<boolean>;
}
