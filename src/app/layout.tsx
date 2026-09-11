import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { siteUrl } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "OpenAgents — the open marketplace for agentic workflows",
    template: "%s · OpenAgents",
  },
  description:
    "Find, install, and publish agentic workflows, harnesses, rules, and skills for Claude Code, Cursor, Codex, and more.",
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: "./" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The enforcing, nonce-based CSP from src/proxy.ts only works with dynamic
  // rendering — a statically prerendered shell has no per-request nonce to
  // embed, so its scripts (including Next's own bootstrap script) would ship
  // with none and get blocked by the browser. `connection()` opts the whole
  // tree into dynamic rendering, which is what the CSP guide recommends for
  // nonce-based CSP. See node_modules/next/dist/docs/.../content-security-policy.md
  // ("Forcing dynamic rendering").
  await connection();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <Header />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
