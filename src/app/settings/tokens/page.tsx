import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { listTokens } from "@/lib/tokens";
import { TokenManager } from "@/components/TokenManager";

export const metadata: Metadata = {
  title: "API tokens",
  description: "Create and manage personal access tokens for the OpenAgents CLI.",
};

export default async function TokensPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/tokens");
  }

  if (!isDbEnabled()) {
    return (
      <PageShell>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-fg-muted">API tokens are not configured on this deployment.</p>
          <p className="mt-2 text-xs text-fg-subtle">
            Set <code className="font-mono">DATABASE_URL</code> — see{" "}
            <code className="font-mono">docs/SETUP.md</code>.
          </p>
        </div>
      </PageShell>
    );
  }

  const tokens = await listTokens(session.user.id);

  return (
    <PageShell>
      <TokenManager
        initialTokens={tokens.map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.prefix,
          scopes: t.scopes,
          lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">API tokens</h1>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Personal access tokens let the OpenAgents CLI publish, star, and download
        packages on your behalf without a browser session. Treat a token like a
        password — anyone with it can act as you, within the scopes you grant it.
      </p>
      {children}
    </div>
  );
}
