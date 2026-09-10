import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/lib/auth";

interface UserMenuProps {
  name?: string | null;
  image?: string | null;
  /** Provider-derived handle; absent when unknown (see B12c) — no profile link then. */
  handle?: string;
}

export async function handleSignOut() {
  "use server";
  await signOut();
}

export function UserMenu({ name, image, handle }: UserMenuProps) {
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
    <div className="flex items-center gap-2">
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
      <Link
        href="/purchases"
        className="rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
      >
        Purchases
      </Link>
      <Link
        href="/settings/payouts"
        className="rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
      >
        Payouts
      </Link>
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
