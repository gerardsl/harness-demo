import { hmacSha256, timingSafeEqual } from "./crypto";

/**
 * HMAC both the submitted passcode and the expected passcode with the same key,
 * then compare the digests in constant time. Digest length is fixed, so the
 * comparison does not leak the passcode length.
 */
export async function passcodeEqual(key: string, provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([hmacSha256(key, provided), hmacSha256(key, expected)]);
  return timingSafeEqual(left, right);
}
