import type { Metadata } from "next";
import type { ReactNode } from "react";
import { enabledProviders, signIn, type ProviderId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to OpenAgents to publish packages and make purchases.",
};

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;
  const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";
  const providers = enabledProviders();

  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-fg">Sign in</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Used to publish packages, star favorites, and make purchases. We only read your
        public profile and email — nothing is posted on your behalf.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">Sign-in is not configured on this deployment.</p>
            <p className="mt-2 text-xs text-fg-subtle">
              Set <code className="font-mono">AUTH_GITHUB_ID</code>/
              <code className="font-mono">AUTH_GITHUB_SECRET</code> and/or{" "}
              <code className="font-mono">AUTH_GOOGLE_ID</code>/
              <code className="font-mono">AUTH_GOOGLE_SECRET</code> — see{" "}
              <code className="font-mono">docs/SETUP.md</code>.
            </p>
          </div>
        ) : (
          providers.map((provider) => (
            <SignInButton key={provider.id} providerId={provider.id} redirectTo={redirectTo}>
              {provider.id === "github" ? <GitHubMark className="h-4 w-4" /> : <GoogleMark className="h-4 w-4" />}
              Continue with {provider.name}
            </SignInButton>
          ))
        )}
      </div>
    </div>
  );
}

function SignInButton({
  providerId,
  redirectTo,
  children,
}: {
  providerId: ProviderId;
  redirectTo: string;
  children: ReactNode;
}) {
  async function handleSignIn() {
    "use server";
    await signIn(providerId, { redirectTo });
  }

  return (
    <form action={handleSignIn}>
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg hover:border-border-strong hover:bg-surface-hover"
      >
        {children}
      </button>
    </form>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M15.68 8.18c0-.57-.05-1.11-.15-1.64H8v3.1h4.3a3.68 3.68 0 0 1-1.6 2.42v1.98h2.58c1.51-1.39 2.4-3.44 2.4-5.86Z"
      />
      <path
        fill="#34A853"
        d="M8 16c2.16 0 3.97-.71 5.29-1.93l-2.58-1.98c-.72.48-1.63.76-2.71.76-2.08 0-3.85-1.4-4.48-3.29H.86v2.05A8 8 0 0 0 8 16Z"
      />
      <path
        fill="#FBBC05"
        d="M3.52 9.56A4.8 4.8 0 0 1 3.27 8c0-.54.09-1.07.25-1.56V4.4H.86a8 8 0 0 0 0 7.2l2.66-2.04Z"
      />
      <path
        fill="#EA4335"
        d="M8 3.15c1.17 0 2.23.4 3.06 1.19l2.29-2.29A7.94 7.94 0 0 0 8 0 8 8 0 0 0 .86 4.4l2.66 2.04C4.15 4.55 5.92 3.15 8 3.15Z"
      />
    </svg>
  );
}
