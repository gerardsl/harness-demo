import type { ReactNode } from "react";

export const metadata = {
  title: "Harness demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0, background: "#0b1020", color: "#eef" }}>
        {children}
      </body>
    </html>
  );
}
