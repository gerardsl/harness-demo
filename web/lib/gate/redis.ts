import { sha256Hex } from "./crypto";
import { normalizeIp } from "./ip";

export const WINDOW_SECONDS = 10 * 60;
export const IP_LIMIT = 5;
export const GLOBAL_LIMIT = 20;

export type Env = Record<string, string | undefined>;

export interface RedisClient {
  get(key: string): Promise<string | null>;
  incr(key: string, ttlSeconds: number): Promise<void>;
}

export function readEnv(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

/** Vercel sets this to production, preview, or development. Local runs use development. */
export function deploymentEnv(env: Env): string {
  return readEnv(env, "VERCEL_ENV") ?? "development";
}

export function redisEndpoint(env: Env): { url: string; token: string } | null {
  const upstashUrl = readEnv(env, "UPSTASH_REDIS_REST_URL");
  const upstashToken = readEnv(env, "UPSTASH_REDIS_REST_TOKEN");
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  const kvUrl = readEnv(env, "KV_REST_API_URL");
  const kvToken = readEnv(env, "KV_REST_API_TOKEN");
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  return null;
}

export async function rateLimitKeys(ip: string, envName: string): Promise<{ ipKey: string; globalKey: string }> {
  const hash = await sha256Hex(normalizeIp(ip));
  const prefix = `harness:${envName}:`;
  return {
    ipKey: `${prefix}pc:ip:${hash}`,
    globalKey: `${prefix}pc:global`,
  };
}

export function parseCount(value: string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function peekFailures(
  client: RedisClient,
  ip: string,
  envName: string,
): Promise<{ ipCount: number; globalCount: number }> {
  const keys = await rateLimitKeys(ip, envName);
  const [ipVal, globalVal] = await Promise.all([client.get(keys.ipKey), client.get(keys.globalKey)]);
  return { ipCount: parseCount(ipVal), globalCount: parseCount(globalVal) };
}

/** Count one failed passcode attempt. Not used for successful logins or valid cookies. */
export async function recordFailure(client: RedisClient, ip: string, envName: string): Promise<void> {
  const keys = await rateLimitKeys(ip, envName);
  await client.incr(keys.ipKey, WINDOW_SECONDS);
  await client.incr(keys.globalKey, WINDOW_SECONDS);
}

export function isLimited(counts: { ipCount: number; globalCount: number }): boolean {
  return counts.ipCount >= IP_LIMIT || counts.globalCount >= GLOBAL_LIMIT;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createUpstashRedis(url: string, token: string, fetchImpl: FetchLike = fetch, timeoutMs = 2000): RedisClient {
  const base = url.replace(/\/$/, "");

  async function call(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error("redis unavailable");
    }
    if (!res.ok) throw new Error("redis unavailable");
    try {
      return await res.json();
    } catch {
      throw new Error("redis unavailable");
    }
  }

  return {
    async get(key: string): Promise<string | null> {
      const body = (await call(`/get/${encodeURIComponent(key)}`, { method: "GET" })) as { result?: unknown };
      if (body.result === null || body.result === undefined) return null;
      return String(body.result);
    },
    async incr(key: string, ttlSeconds: number): Promise<void> {
      await call("/pipeline", {
        method: "POST",
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(ttlSeconds), "NX"],
        ]),
      });
    },
  };
}
