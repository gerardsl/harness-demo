# Harness demo web

Next.js app (App Router) for the static demo. The Python simulator in `../sim` stays the reference. `lib/sim` is the TypeScript port, and `middleware.ts` is the only server entry: an Edge passcode gate. Slides, the terminal page, and buttons are left for the UI pass on this branch.

Set the Vercel project root to `web`. Do not commit secret values.

## Env

Names live in `.env.example`.

| Name | Role |
| --- | --- |
| `DEMO_PASSCODE` | Shared passcode. If it is unset, every request fails closed (500). |
| `SESSION_SECRET` | HMAC key for the session cookie and for the passcode compare. Must be at least 16 characters, or the gate returns 500. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for failed-attempt rate limits. |
| `UPSTASH_REDIS_REST_TOKEN` | Token for that Redis database. |
| `KV_REST_API_URL` | Fallback URL when the Upstash pair is unset. |
| `KV_REST_API_TOKEN` | Fallback token when the Upstash pair is unset. |
| `VERCEL_ENV` | Set by Vercel (`production`, `preview`, `development`). Rate-limit keys are `harness:${VERCEL_ENV}:pc:…`. If unset, the prefix uses `development`. |

Sign-in fails closed (503) when Redis is missing or times out. A request that already has a valid signed cookie does not call Redis.

The cookie is HMAC-SHA256, HttpOnly, Secure, SameSite=Lax, Path=/, and expires after 8 hours. Failed passcode attempts are limited to 5 per IP per 10 minutes (IPv6 bucketed to /64) and 20 globally per 10 minutes.

## Commands

```bash
npm ci
npm test
npm run build
npm run dev
```

`npm test` checks the simulator against `test/golden` and the gate (cookie, constant-time compare, rate-limit keys). Golden files are regenerated from Python with `bash ../sim/make_golden.sh`.

`runScenario(name)` returns `{ lines, exitCode }` for `pass`, `break-eval`, `rogue-tool`, and `no-approval`. `createSession().exec(command)` returns the lines for one interactive command, including the `harness>` prompt. Python prints the help line once before any command; that string is the exported `HELP` constant. Output matches `NO_COLOR=1` (no ANSI).
