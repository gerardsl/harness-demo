import { fromHex, hmacSha256, timingSafeEqual, toHex } from "./crypto";

export const COOKIE_NAME = "harness_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function signSession(secret: string, nowMs: number, sidBytes: Uint8Array): Promise<string> {
  if (sidBytes.length !== 16) throw new Error("sid must be 128 bits");
  const sid = toHex(sidBytes);
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${sid}.${exp}`;
  const sig = toHex(await hmacSha256(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string, nowMs: number): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, sid, expStr, sigHex] = parts;
  if (version !== "v1") return false;
  if (!/^[0-9a-f]{32}$/.test(sid)) return false;
  if (!/^[0-9]+$/.test(expStr)) return false;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp)) return false;
  const provided = fromHex(sigHex);
  const expected = await hmacSha256(secret, `v1.${sid}.${expStr}`);
  if (!provided || !timingSafeEqual(provided, expected)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  return exp > nowSec;
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}
