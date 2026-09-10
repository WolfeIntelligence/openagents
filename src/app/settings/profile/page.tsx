import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { getOwnProfile, ownsAnyPackages } from "@/lib/profile";
import { ProfileForm } from "@/components/ProfileForm";

export const metadata: Metadata = {
  title: "Profile settings",
  description: "Manage your name, bio, website, and handle.",
};

export default async function ProfileSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/settings/profile");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-fg">Profile settings</h1>
      <p className="mt-2 max-w-xl text-sm text-fg-muted">
        This is what other people see on your public profile at{" "}
        <span className="font-mono">/u/&lt;handle&gt;</span>.
      </p>

      <div className="mt-8">
        {!isDbEnabled() ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-muted">
              Profile editing requires a database, which isn&apos;t configured on this deployment.
            </p>
          </div>
        ) : (
          <ProfileFields userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

async function ProfileFields({ userId }: { userId: string }) {
  const [profile, hasPackages] = await Promise.all([getOwnProfile(userId), ownsAnyPackages(userId)]);

  if (!profile) {
    return (
      <p className="text-sm text-fg-muted">We couldn&apos;t find your account. Try signing in again.</p>
    );
  }

  return (
    <ProfileForm
      initialName={profile.name ?? ""}
      initialBio={profile.bio ?? ""}
      initialWebsite={profile.website ?? ""}
      initialHandle={profile.handle ?? ""}
      handleLocked={hasPackages}
    />
  );
}
