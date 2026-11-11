import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function generateInstanceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInstanceSecret(secret: string): {
  secret_hash: string;
  secret_salt: string;
} {
  const secret_salt = randomBytes(16).toString("base64url");
  const secret_hash = scryptSync(secret, secret_salt, SCRYPT_KEYLEN).toString(
    "base64url",
  );
  return { secret_hash, secret_salt };
}

export function verifyInstanceSecret(
  secret: string,
  secret_hash: string,
  secret_salt: string,
): boolean {
  const derived = scryptSync(secret, secret_salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(secret_hash, "base64url");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function hashPassword(password: string): {
  password_hash: string;
  password_salt: string;
} {
  const password_salt = randomBytes(16).toString("base64url");
  const password_hash = scryptSync(password, password_salt, SCRYPT_KEYLEN).toString(
    "base64url",
  );
  return { password_hash, password_salt };
}

export function verifyPassword(
  password: string,
  password_hash: string,
  password_salt: string,
): boolean {
  const derived = scryptSync(password, password_salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(password_hash, "base64url");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}