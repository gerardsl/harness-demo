import styles from "../components/Home.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <h1>Harness demo</h1>
      <p className={styles.lede}>
        Agents run as pipeline steps, then an eval gate, an OPA policy and a human approval decide the merge.
      </p>
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
    </main>
  );
}
