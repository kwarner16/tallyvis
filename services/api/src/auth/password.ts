import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Established, vetted password hashing (bcrypt) — never write custom password crypto. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
