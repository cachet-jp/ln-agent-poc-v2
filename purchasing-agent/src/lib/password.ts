import { randomBytes } from "node:crypto";

/**
 * Character set excluding ambiguous characters (0/O, 1/l/I).
 * Includes lowercase, uppercase, digits, and a few special chars
 * that are broadly accepted by most password policies.
 */
const CHARSET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";

/**
 * Generate a cryptographically random password.
 *
 * @param length - Desired length (default 16)
 * @returns A random password string drawn from CHARSET
 */
export function generatePassword(length = 16): string {
  const bytes = randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += CHARSET[bytes[i] % CHARSET.length];
  }
  return password;
}
