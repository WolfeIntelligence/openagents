import Link from "next/link";
import { Logo } from "@/components/Logo";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Logo className="h-5 w-5" />
          <span>
            OpenAgents is open source, MIT licensed, and built in the open.
          </span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/explore" className="text-fg-muted hover:text-fg">
            Explore
          </Link>
          <Link href="/docs" className="text-fg-muted hover:text-fg">
            Docs
          </Link>
          <Link href="/pricing" className="text-fg-muted hover:text-fg">
            Pricing
          </Link>
          <Link href="/publish" className="text-fg-muted hover:text-fg">
            Publish
          </Link>
          <a
            href="https://github.com/openagents"
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-muted hover:text-fg"
          >
            GitHub
          </a>
          <span className="text-fg-subtle">MIT License</span>
        </nav>
      </div>
    </footer>
  );
}
