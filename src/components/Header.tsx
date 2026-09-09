import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { UserMenu } from "@/components/UserMenu";
import { NavLinks } from "@/components/NavLinks";
import { auth, isAuthEnabled, signIn } from "@/lib/auth";

async function handleSignIn() {
  "use server";
  await signIn("github");
}

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
          ) : authEnabled ? (
            <form action={handleSignIn}>
              <button
                type="submit"
                className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                <GitHubMark className="h-4 w-4" />
                Sign in with GitHub
              </button>
            </form>
          ) : (
            <span
              title="Set AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, and AUTH_SECRET to enable sign-in"
              className="cursor-not-allowed rounded-md border border-border px-3 py-2 text-sm text-fg-subtle"
            >
              Sign in (not configured)
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-2 lg:hidden">
        <SearchBox size="sm" />
      </div>
    </header>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
