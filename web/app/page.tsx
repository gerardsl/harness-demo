import { Atmosphere } from "../components/Atmosphere";
import styles from "../components/Home.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <Atmosphere />
      <div className={styles.stack}>
        <header className={styles.nav}>
          <a className={styles.wordmark} href="/">
            Harness
          </a>
          <nav className={styles.navLinks} aria-label="Primary">
            <a className={styles.navLink} href="/slides">
              Slides
            </a>
            <a className={styles.primary} href="/terminal">
              Terminal
            </a>
          </nav>
        </header>

        <section className={styles.hero}>
          <h1>Harness demo</h1>
          <p className={styles.lede}>
            Agents run as pipeline steps, then an eval gate, an OPA policy and a human approval decide the merge.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="/terminal">
              Open terminal
            </a>
            <a className={styles.outline} href="/slides">
              View slides
            </a>
          </div>
        </section>

        <nav className={styles.links} aria-label="Demo pages">
          <a href="/slides">
            <strong>Slides</strong>
            <span>The loop and the eval gate</span>
          </a>
          <a href="/terminal">
            <strong>Terminal</strong>
            <span>Drive the offline simulator</span>
          </a>
        </nav>
      </div>
    </main>
  );
}
