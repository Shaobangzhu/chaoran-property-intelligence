import type { PasswordHasherPort } from "@chaoran-property-intelligence/application";
import * as argon2 from "argon2";

const memoryCostKibibytes = 19 * 1024;
const timeCost = 2;
const parallelism = 1;

export class Argon2idPasswordHasher implements PasswordHasherPort {
  async hash(
    password: Parameters<PasswordHasherPort["hash"]>[0],
  ): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: memoryCostKibibytes,
      timeCost,
      parallelism,
    });
  }

  async verify(
    password: Parameters<PasswordHasherPort["verify"]>[0],
    passwordHash: string,
  ): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }
}
