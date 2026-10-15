import type { ReactNode } from "react";

export const metadata = {
  title: "Harness demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: "1.5rem" }}>{children}</body>
    </html>
  );
}
