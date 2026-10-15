"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { HELP, createSession, runScenario } from "../lib/sim";
import { Atmosphere } from "./Atmosphere";
import styles from "./Terminal.module.css";
import { lineTone } from "./tone";

export const SCENARIOS = ["pass", "break-eval", "rogue-tool", "no-approval"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

const COMMANDS = [
  { cmd: "run", label: "Run pipeline", tone: "good" },
  { cmd: "break", label: "Break guardrail", tone: "bad" },
  { cmd: "fix", label: "Restore guardrail", tone: "good" },
  { cmd: "rogue", label: "Rogue tool", tone: "bad" },
  { cmd: "noapprove", label: "Skip human approval", tone: "bad" },
] as const;

type Session = ReturnType<typeof createSession>;

type ScenarioView = {
  name: ScenarioName;
  lines: string[];
  exitCode: number;
};

function openSession(): { session: Session; lines: string[] } {
  const session = createSession();
  return { session, lines: [HELP] };
}

type Model = {
  session: Session;
  lines: string[];
  scenario: ScenarioView | null;
  history: string[];
  draft: string;
  cursor: number;
};

function freshModel(): Model {
  const opened = openSession();
  return {
    session: opened.session,
    lines: opened.lines,
    scenario: null,
    history: [],
    draft: "",
    cursor: -1,
  };
}

export function Terminal() {
  const [model, setModel] = useState<Model>(freshModel);
  const [scenarioName, setScenarioName] = useState<ScenarioName>("pass");
  const savedDraft = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { lines, scenario, draft } = model;
  const shown = scenario ? scenario.lines : lines;

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [shown]);

  function submit(command: string) {
    setModel((prev) => {
      const output = prev.session.exec(command);
      return {
        ...prev,
        lines: [...prev.lines, ...output],
        scenario: null,
        history: command.trim() !== "" ? [...prev.history, command] : prev.history,
        draft: "",
        cursor: -1,
      };
    });
    savedDraft.current = "";
  }

  function reset() {
    setModel(freshModel());
    savedDraft.current = "";
    inputRef.current?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (event.key === "ArrowUp") {
      setModel((prev) => {
        if (prev.history.length === 0) return prev;
        const next = prev.cursor === -1 ? prev.history.length - 1 : Math.max(0, prev.cursor - 1);
        if (prev.cursor === -1) savedDraft.current = prev.draft;
        return { ...prev, cursor: next, draft: prev.history[next] ?? "" };
      });
      return;
    }
    setModel((prev) => {
      if (prev.cursor === -1) return prev;
      if (prev.cursor >= prev.history.length - 1) {
        return { ...prev, cursor: -1, draft: savedDraft.current };
      }
      const next = prev.cursor + 1;
      return { ...prev, cursor: next, draft: prev.history[next] ?? "" };
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(draft);
  }

  return (
    <div className={styles.screen}>
      <Atmosphere />
      <div className={styles.frame}>
        <header className={styles.header}>
          <a href="/">Home</a>
          <h1>Terminal</h1>
          <p>One session per page load. Buttons call the same exec path as typing.</p>
        </header>

        <div className={styles.toolbar} role="toolbar" aria-label="Simulator commands">
          {COMMANDS.map((item) => (
            <button
              key={item.cmd}
              type="button"
              className={item.tone === "good" ? styles.good : styles.bad}
              aria-label={item.label}
              onClick={() => submit(item.cmd)}
            >
              {item.cmd}
            </button>
          ))}
          <button type="button" className={styles.neutral} aria-label="Reset session" onClick={reset}>
            reset
          </button>
          <label className={styles.picker} htmlFor="scenario">
            Scenario
            <select
              id="scenario"
              aria-label="Scenario"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value as ScenarioName)}
            >
              {SCENARIOS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.neutral}
            aria-label="Run scenario"
            onClick={() => {
              const result = runScenario(scenarioName);
              setModel((prev) => ({
                ...prev,
                scenario: { name: scenarioName, lines: result.lines, exitCode: result.exitCode },
              }));
            }}
          >
            run scenario
          </button>
        </div>

        <p className={styles.status} role="status">
          {scenario ? `scenario ${scenario.name} · exit ${scenario.exitCode}` : "interactive session"}
        </p>

        <div
          ref={logRef}
          className={styles.log}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Simulator output"
        >
          {shown.map((line, index) => {
            const tone = lineTone(line);
            const className = tone === "plain" ? styles.line : `${styles.line} ${styles[tone]}`;
            return (
              <div key={index} data-testid="term-line" data-tone={tone} className={className}>
                {line}
              </div>
            );
          })}
        </div>

        <form className={styles.prompt} onSubmit={onSubmit}>
          <label htmlFor="command">Command</label>
          <input
            ref={inputRef}
            id="command"
            name="command"
            aria-label="Command"
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(event) => {
              const value = event.target.value;
              setModel((prev) => ({ ...prev, draft: value, cursor: -1 }));
            }}
            onKeyDown={onInputKeyDown}
          />
        </form>
      </div>
    </div>
  );
}
