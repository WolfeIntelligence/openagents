import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/lib/auth";

interface UserMenuProps {
  name?: string | null;
  image?: string | null;
  /** Provider-derived handle; absent when unknown (see B12c) — no profile link then. */
  handle?: string;
  /** Shows the admin queue link. The Header doesn't pass this yet (no caller resolves
   *  it from `users.isAdmin`) — defaults to false so nothing links there until it does. */
  isAdmin?: boolean;
}

export async function handleSignOut() {
  "use server";
  await signOut();
}

// UserMenu is only ever mounted by a caller that already knows the visitor is signed
// in (Header renders it only inside `session?.user ? <UserMenu ... /> : <SignInLink />`)
// — there's no internal "signed out" state to render here, which is what keeps every
// link below unconditional other than the admin one.
const LINKS: { href: string; label: string }[] = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/tokens", label: "API tokens" },
  { href: "/settings/sources", label: "GitHub sync" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stars", label: "Stars" },
  { href: "/purchases", label: "Purchases" },
  { href: "/settings/payouts", label: "Payouts" },
  { href: "/settings/account", label: "Account" },
];

export function UserMenu({ name, image, handle, isAdmin = false }: UserMenuProps) {
  const label = handle ?? name ?? "you";
  const avatar = image ? (
    <Image
      src={image}
      alt=""
      width={24}
      height={24}
      className="h-6 w-6 rounded-full"
    />
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-hover text-xs text-fg-muted">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {handle ? (
        <Link
          href={`/u/${handle}`}
          className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm hover:border-border-strong"
        >
          {avatar}
          <span className="font-mono text-fg-muted">{handle}</span>
        </Link>
      ) : (
        <span className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm">
          {avatar}
          <span className="text-fg-muted">{label}</span>
        </span>
      )}
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          {link.label}
        </Link>
      ))}
      {isAdmin && (
        <Link
          href="/admin"
          className="rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          Admin
        </Link>
      )}
      <form action={handleSignOut}>
        <button
          type="submit"
          className="rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
