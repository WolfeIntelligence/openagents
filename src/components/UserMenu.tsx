import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/lib/auth";

interface UserMenuProps {
  name?: string | null;
  image?: string | null;
  handle: string;
}

async function handleSignOut() {
  "use server";
  await signOut();
}

export function UserMenu({ name, image, handle }: UserMenuProps) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/u/${handle}`}
        className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm hover:border-border-strong"
      >
        {image ? (
          <Image
            src={image}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-hover text-xs text-fg-muted">
            {(name ?? handle).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="font-mono text-fg-muted">{handle}</span>
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
