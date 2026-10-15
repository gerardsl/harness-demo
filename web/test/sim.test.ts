import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HELP, createSession, runScenario } from "../lib/sim";

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), "golden");

function text(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), "utf8");
}

function exitCodes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of readGolden("exit-codes.txt").trim().split("\n")) {
    const [name, code] = line.split(" ");
    out[name] = Number(code);
  }
  return out;
}

function interactive(commands: string[]): { lines: string[]; exitCode: number } {
  const session = createSession();
  const lines = [HELP];
  for (const command of commands) lines.push(...session.exec(command));
  return { lines, exitCode: 0 };
}

const exits = exitCodes();

describe("scenario transcripts", () => {
  for (const name of ["pass", "break-eval", "rogue-tool", "no-approval"]) {
    it(`${name} matches Python byte for byte`, () => {
      const result = runScenario(name);
      expect(text(result.lines)).toBe(readGolden(`${name}.txt`));
      expect(result.exitCode).toBe(exits[name]);
    });
  }
});

describe("interactive transcripts", () => {
  const cases: { name: string; commands: string[] }[] = [
    {
      name: "audience",
      commands: [
        "run",
        "break",
        "run",
        "fix",
        "threshold task_completion 1.1",
        "run",
        "threshold task_completion 0.75",
        "noapprove",
        "run",
        "quit",
      ],
    },
    { name: "rogue", commands: ["rogue", "run", "quit"] },
    {
      name: "bad-threshold",
      commands: [
        "threshold",
        "threshold task_completion",
        "threshold task_completion nope",
        "threshold task_completion 0.9 extra",
        "quit",
      ],
    },
    { name: "unknown-command", commands: ["wat", "help", "quit"] },
    {
      name: "show",
      commands: [
        "task rewrite the guardrail",
        "break",
        "rogue",
        "noapprove",
        "threshold safety 0.3",
        "show",
        "fix",
        "norogue",
        "approve",
        "show",
        "quit",
      ],
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} matches Python byte for byte`, () => {
      const result = interactive(testCase.commands);
      expect(text(result.lines)).toBe(readGolden(`${testCase.name}.txt`));
      expect(result.exitCode).toBe(exits[testCase.name]);
    });
  }

  it("stops after quit", () => {
    const session = createSession();
    session.exec("quit");
    expect(session.exec("run")).toEqual([]);
  });

  it("prints an integral threshold the way Python repr does", () => {
    const session = createSession();
    expect(session.exec("threshold task_completion 1")).toContain("{'task_completion': 1.0}");
  });
});
