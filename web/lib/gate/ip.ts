/** Normalize a client address. IPv6 is bucketed to its /64. IPv4-mapped IPv6 stays IPv4. */

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

export function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (!ip) return "unknown";
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end === -1) return "unknown";
    ip = ip.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (isIpv4(ip)) return canonicalIpv4(ip) ?? "unknown";
  const groups = parseIpv6(ip);
  if (!groups) return "unknown";
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  groups[4] = 0;
  groups[5] = 0;
  groups[6] = 0;
  groups[7] = 0;
  return `${groups.map((group) => group.toString(16)).join(":")}/64`;
}

function isIpv4(ip: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip);
}

function canonicalIpv4(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets.join(".");
}

function parseIpv6(input: string): number[] | null {
  let ip = input;
  const v4tail = ip.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4tail) {
    const canon = canonicalIpv4(v4tail[2]);
    if (!canon) return null;
    const octets = canon.split(".").map((part) => Number(part));
    const hi = (octets[0] << 8) | octets[1];
    const lo = (octets[2] << 8) | octets[3];
    ip = `${v4tail[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const groups: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  if (halves.length === 1) {
    const groups = parseSide(halves[0]);
    if (!groups || groups.length !== 8) return null;
    return groups;
  }
  const left = parseSide(halves[0]);
  const right = parseSide(halves[1]);
  if (!left || !right) return null;
  if (left.length + right.length > 7) return null;
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}
