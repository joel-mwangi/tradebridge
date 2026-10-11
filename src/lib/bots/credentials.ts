import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const encoded = process.env.BOT_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("bot_token_encryption_not_configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("bot_token_encryption_key_invalid");
  return key;
}

/** Encrypt short-lived Deriv OAuth credentials at rest; never store access tokens in logs. */
export function encryptDerivToken(token: string): string {
  if (!token) throw new Error("empty_deriv_token");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64")).join(".");
}

export function decryptDerivToken(encrypted: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("encrypted_deriv_token_invalid");
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64"));
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("encrypted_deriv_token_invalid");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
