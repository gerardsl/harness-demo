// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  cleanup();
});
import { HELP, createSession, runScenario } from "../lib/sim";
import { Slides } from "../components/Slides";
import { SCENARIOS, Terminal } from "../components/Terminal";

function readLines(): string[] {
  return screen.getAllByTestId("term-line").map((node) => node.textContent ?? "");
}

function expectedAfter(commands: string[]): string[] {
  const session = createSession();
  const lines = [HELP];
  for (const command of commands) lines.push(...session.exec(command));
  return lines;
}

const BUTTONS = [
  { name: "Run pipeline", command: "run" },
  { name: "Break guardrail", command: "break" },
  { name: "Restore guardrail", command: "fix" },
  { name: "Rogue tool", command: "rogue" },
  { name: "Skip human approval", command: "noapprove" },
] as const;

describe("terminal buttons share the typed exec path", () => {
  it.each(BUTTONS)("$name output equals typing $command", async ({ name, command }) => {
    const user = userEvent.setup();
    const clicked = render(<Terminal />);
    await user.click(screen.getByRole("button", { name }));
    const fromButton = readLines();
    clicked.unmount();

    render(<Terminal />);
    await user.type(screen.getByRole("textbox", { name: "Command" }), `${command}{Enter}`);
    const fromTyping = readLines();

    expect(fromButton).toEqual(fromTyping);
    expect(fromButton).toEqual(expectedAfter([command]));
  });

  it("a sequence of buttons matches the same sequence typed", async () => {
    const user = userEvent.setup();
    const sequence = ["break", "run", "fix", "rogue", "noapprove"] as const;
    const labels: Record<(typeof sequence)[number], string> = {
      break: "Break guardrail",
      run: "Run pipeline",
      fix: "Restore guardrail",
      rogue: "Rogue tool",
      noapprove: "Skip human approval",
    };

    const clicked = render(<Terminal />);
    for (const command of sequence) {
      await user.click(screen.getByRole("button", { name: labels[command] }));
    }
    const fromButtons = readLines();
    clicked.unmount();

    render(<Terminal />);
    const input = screen.getByRole("textbox", { name: "Command" });
    for (const command of sequence) {
      await user.type(input, `${command}{Enter}`);
    }

    expect(fromButtons).toEqual(readLines());
    expect(fromButtons).toEqual(expectedAfter([...sequence]));
  });

  it("reset restores a fresh session banner", async () => {
    const user = userEvent.setup();
    render(<Terminal />);
    await user.click(screen.getByRole("button", { name: "Run pipeline" }));
    await user.click(screen.getByRole("button", { name: "Reset session" }));
    expect(readLines()).toEqual(expectedAfter([]));
  });

  it.each(SCENARIOS)("scenario %s shows runScenario lines", async (name) => {
    const user = userEvent.setup();
    render(<Terminal />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), name);
    await user.click(screen.getByRole("button", { name: "Run scenario" }));
    const result = runScenario(name);
    expect(readLines()).toEqual(result.lines);
    expect(screen.getByRole("status").textContent).toContain(`exit ${result.exitCode}`);
    expect(screen.getByRole("status").textContent).toContain(name);
  });

  it("up and down recall command history", async () => {
    const user = userEvent.setup();
    render(<Terminal />);
    const input = screen.getByRole("textbox", { name: "Command" });
    await user.type(input, "break{Enter}");
    await user.type(input, "run{Enter}");
    await user.type(input, "{ArrowUp}");
    expect((input as HTMLInputElement).value).toBe("run");
    await user.type(input, "{ArrowUp}");
    expect((input as HTMLInputElement).value).toBe("break");
    await user.type(input, "{ArrowDown}");
    expect((input as HTMLInputElement).value).toBe("run");
    await user.type(input, "{ArrowDown}");
    expect((input as HTMLInputElement).value).toBe("");
  });
});

describe("slides keyboard navigation", () => {
  function counter(): string {
    return screen.getByRole("status").textContent ?? "";
  }

  it("starts on slide 1", () => {
    render(<Slides />);
    expect(counter()).toContain("1 / 2");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("The loop");
  });

  it.each(["ArrowRight", "PageDown", " "])("%s advances to slide 2", (key) => {
    render(<Slides />);
    fireEvent.keyDown(document, { key });
    expect(counter()).toContain("2 / 2");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("eval gate");
  });

  it.each(["ArrowLeft", "PageUp"])("%s returns to slide 1", (key) => {
    render(<Slides />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key });
    expect(counter()).toContain("1 / 2");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("The loop");
  });

  it("does not move past either end", () => {
    render(<Slides />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(counter()).toContain("1 / 2");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(counter()).toContain("2 / 2");
  });
});

describe("line colour does not change simulator text", () => {
  it("marks MERGED lines ok and BLOCKED lines bad", async () => {
    const user = userEvent.setup();
    render(<Terminal />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), "pass");
    await user.click(screen.getByRole("button", { name: "Run scenario" }));
    const log = screen.getByRole("log", { name: "Simulator output" });
    const merged = within(log)
      .getAllByTestId("term-line")
      .find((node) => (node.textContent ?? "").includes("MERGED"));
    expect(merged?.getAttribute("data-tone")).toBe("ok");
    expect(merged?.textContent).toContain("MERGED");

    await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), "rogue-tool");
    await user.click(screen.getByRole("button", { name: "Run scenario" }));
    const blocked = within(screen.getByRole("log"))
      .getAllByTestId("term-line")
      .find((node) => (node.textContent ?? "").includes("BLOCKED"));
    expect(blocked?.getAttribute("data-tone")).toBe("bad");
    expect(blocked?.textContent).toContain("BLOCKED");
  });
});
