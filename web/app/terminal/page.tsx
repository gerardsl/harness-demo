import type { Metadata } from "next";
import { Terminal } from "../../components/Terminal";

export const metadata: Metadata = { title: "Terminal · Harness demo" };

export default function TerminalPage() {
  return <Terminal />;
}
