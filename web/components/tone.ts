/** Classify a simulator line for colour. The text itself is never rewritten. */
export function lineTone(line: string): "ok" | "bad" | "plain" {
  const lower = line.toLowerCase();
  if (
    lower.includes("blocked") ||
    /\bfail\b/i.test(line) ||
    lower.includes("deny:") ||
    lower.includes("above limit") ||
    lower.includes("below threshold")
  ) {
    return "bad";
  }
  if (
    lower.includes("merged") ||
    lower.includes("allowed") ||
    /\bpass\b/i.test(line) ||
    /\bok\b/i.test(line) ||
    lower.includes("approved") ||
    lower.trim() === "allow"
  ) {
    return "ok";
  }
  return "plain";
}
