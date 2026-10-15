import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

let server;
function stop() {
  if (server && !server.killed) server.kill("SIGTERM");
  try {
    const pids = execFileSync("lsof", ["-ti", "tcp:3456"], { encoding: "utf8" });
    for (const pid of pids.split(/\s+/).filter(Boolean)) {
      const child = Number(pid);
      if (child === process.pid) continue;
      try {
        process.kill(child, "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // lsof exits non-zero when nothing is listening
  }
}
function fail(message) {
  console.error(message);
  stop();
  process.exit(1);
}

const sourceRoots = ["app", "lib/sim", "middleware.ts", "next.config.ts"].map((path) => join(root, path));
for (const file of sourceRoots.flatMap((path) => (statSync(path).isDirectory() ? walk(path) : [path]))) {
  if (!/\.(ts|tsx|js|mjs|css)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/https?:\/\//.test(text)) fail(`external URL in source ${file}`);
  if (text.includes("fetch(")) fail(`fetch( in client source ${file}`);
}

const gateDir = join(root, "lib/gate");
for (const file of walk(gateDir).concat([join(root, "middleware.ts")])) {
  const text = readFileSync(file, "utf8");
  if (/(?:from\s+["'](?:node:)?crypto["']|require\(\s*["'](?:node:)?crypto["']\s*\))/.test(text)) {
    fail(`node crypto import in ${file}`);
  }
}

const staticDir = join(root, ".next/static");
const htmlRoots = [join(root, ".next/server/app"), join(root, ".next/server/pages")].filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
});
const htmlFiles = htmlRoots.flatMap((dir) => walk(dir)).filter((file) => file.endsWith(".html"));
const clientFiles = walk(staticDir).filter((file) => /\.(js|css)$/.test(file) && !file.endsWith(".map"));

// App and pages chunks, CSS, and HTML are our client output. Next's shared
// runtime chunks contain React/Next error-doc strings and a router fetch; those
// files are not app code. Any font, CDN, or analytics host is still rejected
// everywhere in the client build.
const ownClient = /\/\.next\/static\/chunks\/(?:app|pages)\/|\.css$|\.html$/;
const blockedHost =
  /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|googletagmanager\.com|google-analytics\.com|plausible\.io|segment\.(com|io)|hotjar\.com|posthog\.com|facebook\.net|doubleclick\.net|sentry-cdn\.com|vercel-insights\.com/i;
const urlRe = /https?:\/\/[^\s"'`)<>]+/g;
const urls = [];
const fetches = [];
const blocked = [];
let scannedOwn = 0;
for (const file of [...clientFiles, ...htmlFiles]) {
  const text = readFileSync(file, "utf8");
  const own = ownClient.test(file);
  if (own) scannedOwn += 1;
  if (text.includes("fetch(") && own) fetches.push(file);
  if (blockedHost.test(text)) blocked.push(file);
  if (file.endsWith(".css") && /url\(\s*['"]?https?:\/\//.test(text)) blocked.push(file);
  if (file.endsWith(".html") && /<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i.test(text)) blocked.push(file);
  if (!own) continue;
  for (const url of text.match(urlRe) ?? []) urls.push(`${file}: ${url}`);
}
if (scannedOwn === 0) fail("no app client chunks were produced");
if (urls.length > 0) fail(`external URL in client code\n${urls.join("\n")}`);
if (fetches.length > 0) fail(`fetch( in client code\n${fetches.join("\n")}`);
if (blocked.length > 0) fail(`font, CDN, or analytics host in the build\n${blocked.join("\n")}`);

const manifest = JSON.parse(readFileSync(join(root, ".next/server/middleware-manifest.json"), "utf8"));
const matchers = Object.values(manifest.middleware ?? {}).flatMap((entry) => entry.matchers ?? []);
if (matchers.length === 0) fail("middleware manifest has no matchers");
const paths = [
  "/slides",
  "/_next/static/chunks/app/page-abc123.js",
  "/_next/image",
  "/favicon.ico",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/",
];
for (const path of paths) {
  const matched = matchers.some((matcher) => {
    if (matcher.originalSource?.includes("_next/static") && matcher.originalSource.includes("?!")) return false;
    try {
      return new RegExp(matcher.regexp).test(path);
    } catch {
      return false;
    }
  });
  if (!matched) {
    fail(`middleware matcher missed ${path}\n${JSON.stringify(matchers, null, 2)}`);
  }
}
for (const matcher of matchers) {
  const source = matcher.originalSource ?? "";
  if (source.includes("?!_next/static") || source.includes("favicon.ico")) {
    fail(`matcher excludes static or favicon: ${source}`);
  }
}

const port = 3456;
server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    DEMO_PASSCODE: "gate-check-passcode",
    SESSION_SECRET: "gate-check-secret-16",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const logs = [];
server.stdout.on("data", (chunk) => logs.push(String(chunk)));
server.stderr.on("data", (chunk) => logs.push(String(chunk)));

try {
  const ready = await waitForServer(port);
  if (!ready) fail(`next start did not become ready\n${logs.join("")}`);
  await assertGated(port, "/slides", { accept: "text/html" }, async (res) => {
    if (res.status !== 200) fail(`/slides status ${res.status}`);
    const body = await res.text();
    if (!body.includes('data-harness-gate="passcode"')) fail("/slides did not return the passcode form");
  });
  await assertGated(port, "/_next/static/chunks/app/page-abc123.js", { accept: "*/*" }, async (res) => {
    if (res.status !== 401) fail(`js chunk status ${res.status}`);
  });
  for (const path of ["/favicon.ico", "/icon.svg", "/apple-touch-icon.png"]) {
    await assertGated(port, path, { accept: "text/html" }, async (res) => {
      const body = await res.text();
      if (res.status !== 200 || !body.includes('data-harness-gate="passcode"')) {
        fail(`${path} was not gated (status ${res.status})`);
      }
    });
  }
  console.log("build checks passed");
} finally {
  stop();
}
process.exit(0);

async function waitForServer(portNumber) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${portNumber}/slides`, { headers: { accept: "text/html" } });
      if (res.status === 200) {
        await res.text();
        return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function assertGated(portNumber, path, headers, check) {
  const res = await fetch(`http://127.0.0.1:${portNumber}${path}`, { headers });
  await check(res);
}
