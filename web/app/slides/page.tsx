import type { Metadata } from "next";
import { Slides } from "../../components/Slides";

export const metadata: Metadata = { title: "Slides · Harness demo" };

export default function SlidesPage() {
  return <Slides />;
}
