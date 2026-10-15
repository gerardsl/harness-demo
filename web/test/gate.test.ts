import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { passcodeEqual } from "../lib/gate/compare";
import { signSession, verifySession } from "../lib/gate/cookie";
import { fromHex, timingSafeEqual, toHex } from "../lib/gate/crypto";
import { handleGate } from "../lib/gate/handle";
import { normalizeIp } from "../lib/gate/ip";
import {
  WINDOW_SECONDS,
  createUpstashRedis,
  deploymentEnv,
  rateLimitKeys,
  type RedisClient,
} from "../lib/gate/redis";

const SECRET = "session-secret-16b";
const PASSCODE = "correct-horse";
const NOW = 1_700_000_000_000;
const SID = new Uint8Array(16);
for (let i = 0; i < SID.length; i++) SID[i] = i + 1;

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type Call = { op: "get" | "incr"; key: string; ttlSeconds?: number };

function mockRedis(reply: (key: string) => string | null): { client: RedisClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: RedisClient = {
    async get(key: string) {
      calls.push({ op: "get", key });
      return reply(key);
    },
    async incr(key: string, ttlSeconds: number) {
      calls.push({ op: "incr", key, ttlSeconds });
    },
  };
  return { client, calls };
}

function counts(globalCount: string, ipCount: string) {
  return (key: string) => {
    if (key.endsWith(":pc:global")) return globalCount;
    if (key.includes(":pc:ip:")) return ipCount;
    return null;
  };
}

function env(extra: Record<string, string | undefined> = {}) {
  return {
    DEMO_PASSCODE: PASSCODE,
    SESSION_SECRET: SECRET,
    VERCEL_ENV: "preview",
    ...extra,
  };
}

function post(path: string, passcode: string, headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ passcode });
  return new Request(`https://demo.example${path}`, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body,
  });
}

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://demo.example${path}`, { headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("constant-time compare", () => {
  it("compares equal and unequal digests without an early length exit", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 9]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it("HMACs both passcode values with the key before comparing", async () => {
    const sign = vi.spyOn(crypto.subtle, "sign");
    await expect(passcodeEqual(SECRET, PASSCODE, PASSCODE)).resolves.toBe(true);
    expect(sign).toHaveBeenCalledTimes(2);
    sign.mockClear();
    await expect(passcodeEqual(SECRET, "nope", PASSCODE)).resolves.toBe(false);
    await expect(passcodeEqual(SECRET, "", PASSCODE)).resolves.toBe(false);
    await expect(passcodeEqual(SECRET, "short", "much-longer-passcode")).resolves.toBe(false);
    expect(sign.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("session cookie", () => {
  it("signs a 128-bit sid that verifies until the 8h expiry", async () => {
    const token = await signSession(SECRET, NOW, SID);
    const [, sid, exp] = token.split(".");
    expect(sid).toBe(toHex(SID));
    expect(sid).toHaveLength(32);
    expect(Number(exp)).toBe(Math.floor(NOW / 1000) + 8 * 60 * 60);
    await expect(verifySession(token, SECRET, NOW)).resolves.toBe(true);
    await expect(verifySession(token, SECRET, NOW + 8 * 60 * 60 * 1000 - 1000)).resolves.toBe(true);
    await expect(verifySession(token, SECRET, NOW + 8 * 60 * 60 * 1000)).resolves.toBe(false);
  });

  it("rejects a tampered, expired, malformed, or cross-signed cookie", async () => {
    const token = await signSession(SECRET, NOW, SID);
    const parts = token.split(".");
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -1)}${parts[3].endsWith("0") ? "1" : "0"}`;
    await expect(verifySession(flipped, SECRET, NOW)).resolves.toBe(false);
    const bumped = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}.${parts[3]}`;
    await expect(verifySession(bumped, SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession("nope", SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession(`${token}.extra`, SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession(token, `${SECRET}-other`, NOW)).resolves.toBe(false);
    const expired = await signSession(SECRET, NOW - 8 * 60 * 60 * 1000, SID);
    await expect(verifySession(expired, SECRET, NOW)).resolves.toBe(false);
    expect(fromHex("zz")).toBeNull();
  });
});

describe("rate-limit key normalization", () => {
  it("buckets IPv6 to /64 and keeps IPv4 distinct", () => {
    const a = normalizeIp("2001:db8:85a3:0:1:2:3:4");
    const b = normalizeIp("2001:DB8:85A3:0:ffff:ffff:ffff:ffff");
    const c = normalizeIp("[2001:db8:85a3::8a2e:370:7334]:443");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(normalizeIp("2001:db8:85a3:1::1")).not.toBe(a);
    expect(normalizeIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeIp("192.000.002.010")).toBe("192.0.2.10");
    expect(normalizeIp("192.0.2.10:443")).toBe("192.0.2.10");
    expect(normalizeIp("not-an-ip")).toBe("unknown");
  });

  it("prefixes every key with harness:${VERCEL_ENV} and separates preview from production", async () => {
    expect(deploymentEnv({})).toBe("development");
    expect(deploymentEnv({ VERCEL_ENV: "" })).toBe("development");
    expect(deploymentEnv({ VERCEL_ENV: "preview" })).toBe("preview");

    const preview = await rateLimitKeys("203.0.113.8", "preview");
    const production = await rateLimitKeys("203.0.113.8", "production");
    const development = await rateLimitKeys("203.0.113.8", "development");
    expect(preview.globalKey).toBe("harness:preview:pc:global");
    expect(production.globalKey).toBe("harness:production:pc:global");
    expect(development.globalKey).toBe("harness:development:pc:global");
    expect(preview.globalKey).not.toBe(production.globalKey);
    expect(preview.ipKey.startsWith("harness:preview:pc:ip:")).toBe(true);
    expect(production.ipKey.startsWith("harness:production:pc:ip:")).toBe(true);
    expect(preview.ipKey).not.toBe(production.ipKey);
    expect(preview.ipKey).not.toContain("203.0.113.8");

    const same64 = await rateLimitKeys("2001:db8:85a3:0:1:2:3:4", "preview");
    const same64b = await rateLimitKeys("2001:db8:85a3:0:aaaa:bbbb:cccc:dddd", "preview");
    const other64 = await rateLimitKeys("2001:db8:85a3:1::1", "preview");
    expect(same64.ipKey).toBe(same64b.ipKey);
    expect(same64.ipKey).not.toBe(other64.ipKey);
    expect(same64.globalKey).toBe("harness:preview:pc:global");
  });
});

describe("passcode gate", () => {
  it("serves the form for HTML navigation and 401 for a JS chunk without a cookie", async () => {
    const slides = await handleGate(get("/slides", { accept: "text/html" }), { env: env(), redis: null, now: NOW });
    expect(slides.type).toBe("response");
    if (slides.type !== "response") return;
    expect(slides.response.status).toBe(200);
    expect(await slides.response.text()).toContain('data-harness-gate="passcode"');

    const chunk = await handleGate(
      get("/_next/static/chunks/app/page-abc123.js", { accept: "*/*" }),
      { env: env(), redis: null, now: NOW },
    );
    expect(chunk.type).toBe("response");
    if (chunk.type !== "response") return;
    expect(chunk.response.status).toBe(401);
    expect(await chunk.response.text()).not.toContain("data-harness-gate");

    for (const path of ["/favicon.ico", "/icon.svg", "/apple-touch-icon.png", "/_next/image"]) {
      const res = await handleGate(get(path, { accept: "text/html" }), { env: env(), redis: null, now: NOW });
      expect(res.type).toBe("response");
      if (res.type !== "response") return;
      expect(res.response.status).toBe(200);
      expect(await res.response.text()).toContain("data-harness-gate");
    }
  });

  it("does not call redis for a valid cookie, even when the store would fail", async () => {
    const token = await signSession(SECRET, NOW, SID);
    const redis: RedisClient = {
      async get() {
        throw new Error("should not be called");
      },
      async incr() {
        throw new Error("should not be called");
      },
    };
    const decision = await handleGate(
      get("/slides", { accept: "text/html", cookie: `harness_session=${token}` }),
      { env: env(), redis, now: NOW },
    );
    expect(decision.type).toBe("next");

    const missing = await handleGate(
      get("/_next/static/chunks/app/page-abc123.js", {
        accept: "*/*",
        cookie: `harness_session=${token}`,
      }),
      { env: env(), redis: null, now: NOW },
    );
    expect(missing.type).toBe("next");
  });

  it("rejects a tampered cookie with the form or 401 and does not call redis", async () => {
    const token = await signSession(SECRET, NOW, SID);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    let calls = 0;
    const redis: RedisClient = {
      async get() {
        calls += 1;
        return null;
      },
      async incr() {
        calls += 1;
      },
    };
    const html = await handleGate(
      get("/slides", { accept: "text/html", cookie: `harness_session=${tampered}` }),
      { env: env(), redis, now: NOW },
    );
    expect(html.type).toBe("response");
    if (html.type === "response") expect(html.response.status).toBe(200);
    const asset = await handleGate(
      get("/_next/static/chunks/app/page-abc123.js", { accept: "*/*", cookie: `harness_session=${tampered}` }),
      { env: env(), redis, now: NOW },
    );
    expect(asset.type).toBe("response");
    if (asset.type === "response") expect(asset.response.status).toBe(401);
    expect(calls).toBe(0);
  });

  it("does not record a successful login", async () => {
    const redis = mockRedis(counts("0", "0"));
    redis.client.incr = async () => {
      throw new Error("successful login must not be counted");
    };
    const decision = await handleGate(post("/slides", PASSCODE), {
      env: env(),
      redis: redis.client,
      now: NOW,
      randomBytes: SID,
    });
    expect(decision.type).toBe("response");
    if (decision.type !== "response") return;
    expect(decision.response.status).toBe(303);
    expect(decision.response.headers.get("location")).toBe("https://demo.example/");
    const setCookie = decision.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain(PASSCODE);
    expect(setCookie).not.toContain(SECRET);
    const token = setCookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    await expect(verifySession(token, SECRET, NOW)).resolves.toBe(true);
    expect(redis.calls.filter((call) => call.op === "incr")).toHaveLength(0);
    expect(redis.calls.filter((call) => call.op === "get").length).toBeGreaterThan(0);
  });

  it("records only a failed passcode and prefixes the keys", async () => {
    const redis = mockRedis(counts("3", "1"));
    const decision = await handleGate(post("/slides", "wrong"), {
      env: env(),
      redis: redis.client,
      now: NOW,
      randomBytes: SID,
    });
    expect(decision.type).toBe("response");
    if (decision.type !== "response") return;
    expect(decision.response.status).toBe(401);
    expect(await decision.response.text()).toContain("Incorrect passcode.");
    const writes = redis.calls.filter((call) => call.op === "incr");
    expect(writes).toHaveLength(2);
    expect(writes.every((call) => call.ttlSeconds === WINDOW_SECONDS)).toBe(true);
    expect(writes.map((call) => call.key).some((key) => key === "harness:preview:pc:global")).toBe(true);
    expect(writes.every((key) => key.key.startsWith("harness:preview:"))).toBe(true);
  });

  it("blocks when the global count is 20 even if this IP is under its limit", async () => {
    const redis = mockRedis(counts("20", "0"));
    const decision = await handleGate(post("/slides", PASSCODE), {
      env: env(),
      redis: redis.client,
      now: NOW,
      randomBytes: SID,
    });
    expect(decision.type).toBe("response");
    if (decision.type !== "response") return;
    expect(decision.response.status).toBe(429);
    expect(decision.response.headers.get("retry-after")).toBe(String(WINDOW_SECONDS));
    expect(decision.response.headers.get("set-cookie")).toBeNull();
    expect(redis.calls.some((call) => call.op === "incr")).toBe(false);
    expect(redis.calls.some((call) => call.key === "harness:preview:pc:global")).toBe(true);
  });

  it("blocks when the IP has 5 failures even if the global count is under 20", async () => {
    const redis = mockRedis(counts("4", "5"));
    const decision = await handleGate(post("/", PASSCODE, { "x-forwarded-for": "198.51.100.4" }), {
      env: env(),
      redis: redis.client,
      now: NOW,
    });
    expect(decision.type).toBe("response");
    if (decision.type !== "response") return;
    expect(decision.response.status).toBe(429);
    expect(redis.calls.some((call) => call.op === "incr")).toBe(false);
  });

  it("still allows an attempt at 4 IP failures and 19 global failures", async () => {
    const redis = mockRedis(counts("19", "4"));
    const decision = await handleGate(post("/", "wrong"), {
      env: env(),
      redis: redis.client,
      now: NOW,
    });
    expect(decision.type).toBe("response");
    if (decision.type !== "response") return;
    expect(decision.response.status).toBe(401);
    expect(redis.calls.filter((call) => call.op === "incr")).toHaveLength(2);
  });

  it("uses distinct preview and production keys, and development when VERCEL_ENV is unset", async () => {
    const preview = mockRedis(counts("0", "0"));
    await handleGate(post("/", "wrong"), { env: env({ VERCEL_ENV: "preview" }), redis: preview.client, now: NOW });
    const production = mockRedis(counts("0", "0"));
    await handleGate(post("/", "wrong"), {
      env: env({ VERCEL_ENV: "production" }),
      redis: production.client,
      now: NOW,
    });
    const local = mockRedis(counts("0", "0"));
    const localEnv = env();
    delete localEnv.VERCEL_ENV;
    await handleGate(post("/", "wrong"), { env: localEnv, redis: local.client, now: NOW });

    const key = (calls: Call[], suffix: string) => calls.find((call) => call.op === "incr" && call.key.endsWith(suffix))?.key;
    expect(key(preview.calls, ":pc:global")).toBe("harness:preview:pc:global");
    expect(key(production.calls, ":pc:global")).toBe("harness:production:pc:global");
    expect(key(local.calls, ":pc:global")).toBe("harness:development:pc:global");
    expect(key(preview.calls, ":pc:global")).not.toBe(key(production.calls, ":pc:global"));
    const previewIp = preview.calls.find((call) => call.op === "incr" && call.key.includes(":pc:ip:"))?.key;
    const productionIp = production.calls.find((call) => call.op === "incr" && call.key.includes(":pc:ip:"))?.key;
    expect(previewIp?.startsWith("harness:preview:pc:ip:")).toBe(true);
    expect(productionIp?.startsWith("harness:production:pc:ip:")).toBe(true);
    expect(previewIp).not.toBe(productionIp);
  });

  it("shares one IP key across an IPv6 /64", async () => {
    const redis = mockRedis(counts("0", "0"));
    await handleGate(post("/", "wrong", { "x-forwarded-for": "2001:db8:85a3:9:1::1, 10.0.0.8" }), {
      env: env(),
      redis: redis.client,
      now: NOW,
    });
    const first = redis.calls.find((call) => call.op === "incr" && call.key.includes(":pc:ip:"))?.key;
    await handleGate(post("/", "wrong", { "x-forwarded-for": "2001:db8:85a3:9:ffff::2" }), {
      env: env(),
      redis: redis.client,
      now: NOW,
    });
    const second = redis.calls.filter((call) => call.op === "incr" && call.key.includes(":pc:ip:")).at(-1)?.key;
    expect(first).toBe(second);
    expect(first?.startsWith("harness:preview:pc:ip:")).toBe(true);
  });

  it("fails closed on sign-in when redis is missing or times out, and keeps a valid cookie working", async () => {
    const missing = await handleGate(post("/", PASSCODE), { env: env(), redis: null, now: NOW });
    expect(missing.type).toBe("response");
    if (missing.type === "response") expect(missing.response.status).toBe(503);

    const hanging: RedisClient = {
      async get() {
        return new Promise(() => {});
      },
      async incr() {
        return new Promise(() => {});
      },
    };
    const timedOut = await handleGate(post("/", PASSCODE), {
      env: env(),
      redis: hanging,
      timeoutMs: 20,
      now: NOW,
    });
    expect(timedOut.type).toBe("response");
    if (timedOut.type === "response") expect(timedOut.response.status).toBe(503);

    const token = await signSession(SECRET, NOW, SID);
    const stillIn = await handleGate(
      get("/slides", { accept: "text/html", cookie: `harness_session=${token}` }),
      { env: env(), redis: hanging, timeoutMs: 20, now: NOW },
    );
    expect(stillIn.type).toBe("next");

    const unset = env();
    const noStore = await handleGate(post("/", PASSCODE), { env: unset, now: NOW });
    expect(noStore.type).toBe("response");
    if (noStore.type === "response") expect(noStore.response.status).toBe(503);
  });

  it("fails closed when the passcode or session secret is missing", async () => {
    const noPass = await handleGate(get("/slides", { accept: "text/html" }), {
      env: { SESSION_SECRET: SECRET },
      now: NOW,
    });
    expect(noPass.type).toBe("response");
    if (noPass.type === "response") expect(noPass.response.status).toBe(500);
    const short = await handleGate(post("/", PASSCODE), {
      env: env({ SESSION_SECRET: "too-short" }),
      redis: null,
      now: NOW,
    });
    expect(short.type).toBe("response");
    if (short.type === "response") expect(short.response.status).toBe(500);
  });

  it("does not log the passcode, cookie, or token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = await signSession(SECRET, NOW, SID);
    const redis = mockRedis(counts("0", "0"));
    await handleGate(post("/", "wrong", { cookie: `harness_session=${token}x` }), {
      env: env({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "rest-token-value",
      }),
      redis: redis.client,
      now: NOW,
    });
    const dumped = [log, info, error, warn].flatMap((spy) => spy.mock.calls.flat().map((part) => String(part))).join("\n");
    expect(dumped).not.toContain(PASSCODE);
    expect(dumped).not.toContain("wrong");
    expect(dumped).not.toContain(SECRET);
    expect(dumped).not.toContain(token);
    expect(dumped).not.toContain("rest-token-value");
  });
});

describe("upstash rest client", () => {
  it("reads and increments without putting the token in the URL or the error", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith("/pipeline")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
      return new Response(JSON.stringify({ result: "4" }), { status: 200 });
    };
    const client = createUpstashRedis("https://example.upstash.io/", "rest-token-value", fetchImpl, 1000);
    await expect(client.get("harness:preview:pc:global")).resolves.toBe("4");
    await client.incr("harness:preview:pc:global", 600);
    expect(seen[0]?.url).toBe("https://example.upstash.io/get/harness%3Apreview%3Apc%3Aglobal");
    expect(new Headers(seen[0]?.init?.headers).get("authorization")).toBe("Bearer rest-token-value");
    expect(seen[0]?.url).not.toContain("rest-token-value");
    const pipeline = JSON.parse(String(seen[1]?.init?.body));
    expect(pipeline).toEqual([
      ["INCR", "harness:preview:pc:global"],
      ["EXPIRE", "harness:preview:pc:global", "600", "NX"],
    ]);

    const failing = createUpstashRedis(
      "https://example.upstash.io",
      "rest-token-value",
      async () => {
        throw new Error("Bearer rest-token-value");
      },
      1000,
    );
    await expect(failing.get("k")).rejects.toThrow(/^redis unavailable$/);
  });
});

describe("source boundaries", () => {
  it("keeps Web Crypto only and matches every path from middleware", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "test") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(path);
      }
    };
    walk(webRoot);
    const importPattern = /(?:from\s+["'](?:node:)?crypto["']|require\(\s*["'](?:node:)?crypto["']\s*\))/;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (importPattern.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    const middleware = readFileSync(join(webRoot, "middleware.ts"), "utf8");
    expect(middleware).toContain('matcher: ["/(.*)"]');
    expect(middleware).not.toContain("_next/static");
    expect(middleware).not.toMatch(/process\.env\.(DEMO_PASSCODE|SESSION_SECRET|UPSTASH|KV_REST|VERCEL_ENV)/);
  });
});
