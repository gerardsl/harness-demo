import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

const display = localFont({
  src: [{ path: "./fonts/newsreader-latin-300-normal.woff2", weight: "300", style: "normal" }],
  variable: "--font-display",
  display: "swap",
  fallback: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Times New Roman", "serif"],
});

export const metadata = {
  title: "Harness demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
