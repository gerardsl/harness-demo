import { passcodeEqual } from "./compare";
import { COOKIE_NAME, readCookie, sessionCookie, signSession, verifySession } from "./cookie";
import { formHtml } from "./form";
import { clientIp } from "./ip";
import {
  WINDOW_SECONDS,
  createUpstashRedis,
  deploymentEnv,
  isLimited,
  peekFailures,
  readEnv,
  recordFailure,
  redisEndpoint,
  type Env,
  type RedisClient,
} from "./redis";

export type GateDecision = { type: "next" } | { type: "response"; response: Response };

export type GateOptions = {
  env?: Env;
  redis?: RedisClient | null;
  now?: number;
  randomBytes?: Uint8Array;
  timeoutMs?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

const DEFAULT_TIMEOUT_MS = 2000;

function textResponse(body: string, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(body, { status, headers });
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/html");
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readPasscode(request: Request): Promise<string> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const data = (await request.json()) as { passcode?: unknown };
      return typeof data.passcode === "string" ? data.passcode : "";
    }
    const form = await request.formData();
    const value = form.get("passcode");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function resolveRedis(env: Env, options: GateOptions): RedisClient | null {
  if (options.redis !== undefined) return options.redis;
  const endpoint = redisEndpoint(env);
  if (!endpoint) return null;
  return createUpstashRedis(endpoint.url, endpoint.token, options.fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

function unavailable(): GateDecision {
  return { type: "response", response: textResponse("unavailable", 503) };
}

function tooMany(): GateDecision {
  return {
    type: "response",
    response: textResponse("too many attempts", 429, { "retry-after": String(WINDOW_SECONDS) }),
  };
}

function unauthenticated(request: Request, failed: boolean): GateDecision {
  if (wantsHtml(request)) {
    return { type: "response", response: htmlResponse(formHtml(failed), failed ? 401 : 200) };
  }
  return { type: "response", response: textResponse("unauthorized", 401) };
}

export async function handleGate(request: Request, options: GateOptions = {}): Promise<GateDecision> {
  const env = options.env ?? process.env;
  const secret = readEnv(env, "SESSION_SECRET");
  const passcode = readEnv(env, "DEMO_PASSCODE");
  if (!secret || secret.length < 16 || !passcode) {
    return { type: "response", response: textResponse("misconfigured", 500) };
  }

  const now = options.now ?? Date.now();
  const cookie = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (cookie && (await verifySession(cookie, secret, now))) {
    return { type: "next" };
  }

  if (request.method !== "POST") return unauthenticated(request, false);

  const redis = resolveRedis(env, options);
  if (!redis) return unavailable();

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ip = clientIp(request);
  const envName = deploymentEnv(env);
  let counts: { ipCount: number; globalCount: number };
  try {
    counts = await withTimeout(peekFailures(redis, ip, envName), timeoutMs);
  } catch {
    return unavailable();
  }
  if (isLimited(counts)) return tooMany();

  const provided = await readPasscode(request);
  const ok = await passcodeEqual(secret, provided, passcode);
  if (ok) {
    const sid = options.randomBytes ?? crypto.getRandomValues(new Uint8Array(16));
    const token = await signSession(secret, now, sid);
    const headers = new Headers();
    headers.set("set-cookie", sessionCookie(token));
    headers.set("location", new URL("/", request.url).toString());
    headers.set("cache-control", "no-store");
    return { type: "response", response: new Response(null, { status: 303, headers }) };
  }

  try {
    await withTimeout(recordFailure(redis, ip, envName), timeoutMs);
  } catch {
    return unavailable();
  }
  return unauthenticated(request, true);
}
