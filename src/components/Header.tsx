import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { UserMenu } from "@/components/UserMenu";
import { NavLinks } from "@/components/NavLinks";
import { auth, isAuthEnabled } from "@/lib/auth";

export async function Header() {
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await auth() : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none"
        >
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">
            OpenAgents
          </span>
          <span className="rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            beta
          </span>
        </Link>

        <NavLinks className="hidden shrink-0 items-center gap-1 md:flex" />

        <div className="hidden flex-1 justify-center px-4 lg:flex">
          <div className="w-full max-w-sm">
            <SearchBox size="sm" />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {session?.user ? (
            <UserMenu
              name={session.user.name}
              image={session.user.image}
              handle={session.user.handle ?? session.user.name ?? "you"}
            />
          ) : (
            <Link
              href="/signin"
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-2 lg:hidden">
        <SearchBox size="sm" />
      </div>
    </header>
  );
}
