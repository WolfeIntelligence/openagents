import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { NewCollectionForm } from "@/app/collections/new/NewCollectionForm";

export const metadata: Metadata = {
  title: "New collection",
  description: "Create a curated, ordered list of packages.",
};

export default async function NewCollectionPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/collections/new");
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">New collection</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Group packages into an ordered list you can share as one link.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        {isDbEnabled() ? (
          <NewCollectionForm />
        ) : (
          <p className="text-sm text-fg-muted">
            Collections require a database, which isn&apos;t configured on this deployment.
          </p>
        )}
      </div>
    </div>
  );
}
