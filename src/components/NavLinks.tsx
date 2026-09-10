"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/publish", label: "Publish" },
];

export function NavLinks({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={className}>
      {NAV_LINKS.map((link) => {
        const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              active ? "text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
