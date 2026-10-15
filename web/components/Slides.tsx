"use client";

import { useCallback, useEffect, useState } from "react";
import { Atmosphere } from "./Atmosphere";
import styles from "./Slides.module.css";

const SLIDES = [
  {
    title: "1 · The loop: task in → agents out → review back",
    body: (
      <>
        <div className={styles.row}>
          <div className={styles.box}>
            Task
            <small>pipeline input</small>
          </div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>Planner</div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>
            Coder
            <small>writes branch, opens PR</small>
          </div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>Tester</div>
          <div className={styles.arrow}>→</div>
          <div className={`${styles.box} ${styles.good}`}>
            Reviewer
            <small>review back</small>
          </div>
        </div>
        <p>
          Each agent is a <strong>pipeline step</strong>, so it gets the pipeline&apos;s RBAC, OPA, approvals and audit trail.
        </p>
        <p>
          Tool calls go through the MCP gateway, which allows only <strong>connector tools ∩ agent allow-list</strong>. Anything else is blocked and logged.
        </p>
      </>
    ),
  },
  {
    title: "2 · The eval gate: nothing merges until evals pass",
    body: (
      <>
        <div className={styles.row}>
          <div className={styles.box}>PR from agents</div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>
            Eval suite
            <small>dataset × metrics × thresholds</small>
          </div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>
            OPA policy step
            <small>deny rules on scores</small>
          </div>
          <div className={styles.arrow}>→</div>
          <div className={styles.box}>Human approval</div>
          <div className={styles.arrow}>→</div>
          <div className={`${styles.box} ${styles.good}`}>Merge</div>
        </div>
        <div className={styles.row}>
          <div className={`${styles.box} ${styles.bad}`}>
            OPA blocks
            <small>safety &lt; 0.95 · secret leak · evals failed</small>
          </div>
          <div className={`${styles.box} ${styles.bad}`}>
            Approval stage blocks
            <small>no human approval</small>
          </div>
        </div>
        <p>A regression fails the pipeline the same way a failed unit test does.</p>
      </>
    ),
  },
] as const;

function clampIndex(index: number): number {
  return Math.max(0, Math.min(SLIDES.length - 1, index));
}

export function Slides() {
  const [index, setIndex] = useState(0);
  const go = useCallback((delta: number) => {
    setIndex((current) => clampIndex(current + delta));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const slide = SLIDES[index];

  return (
    <div className={styles.deck}>
      <Atmosphere />
      <section
        className={styles.slide}
        aria-roledescription="slide"
        aria-label={slide.title}
        onClick={() => go(1)}
      >
        <div className={styles.column}>
          <a className={styles.home} href="/" onClick={(event) => event.stopPropagation()}>
            Home
          </a>
          <h1>{slide.title}</h1>
          {slide.body}
        </div>
      </section>
      <p className={styles.counter} role="status">
        <span className={styles.hint}>← → · space · page up / down · click</span>
        <span>
          {index + 1} / {SLIDES.length}
        </span>
      </p>
    </div>
  );
}
