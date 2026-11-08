import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison for secrets (API keys, passwords).
 *
 * Both inputs are hashed with SHA-256 first so the buffers always have the same
 * length, which avoids leaking the secret length through `timingSafeEqual`'s
 * length check.
 */
export function secureCompare(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
