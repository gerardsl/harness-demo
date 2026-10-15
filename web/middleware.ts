import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleGate } from "./lib/gate/handle";

const ENV_NAMES = [
  "DEMO_PASSCODE",
  "SESSION_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "VERCEL_ENV",
] as const;

function runtimeEnv(): Record<string, string | undefined> {
  const source = process.env;
  const out: Record<string, string | undefined> = {};
  for (const name of ENV_NAMES) out[name] = source[name];
  return out;
}

export async function middleware(request: NextRequest) {
  const decision = await handleGate(request, { env: runtimeEnv() });
  if (decision.type === "next") {
    const response = NextResponse.next();
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
  return decision.response;
}

// Gate every path. The passcode form is produced here, so static chunks,
// image optimization, favicon, icons, and public assets are included.
export const config = {
  matcher: ["/(.*)"],
};
