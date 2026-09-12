"use client";

import { useState, type FormEvent } from "react";
import type { OrgMemberRow, OrgRole } from "@/lib/orgs";

// A type-only import of `@/lib/orgs` above is erased entirely at compile
// time, but importing its `ORG_ROLES` *value* would pull that whole module
// (and its `reserved.ts` -> `node:fs`/`node:path` dependency) into this
// client bundle — Next.js's webpack build fails outright on a `node:*`
// import reaching client code. Duplicating this 3-item literal is cheaper
// than restructuring orgs.ts's server-only exports around it.
const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

async function readError(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error) || fallback;
  }
  return fallback;
}

/**
 * Member list + management for one org, used on `/settings/orgs`. Everyone
 * sees the list; only `viewerRole` "owner"/"admin" gets the add-member form
 * and role selects. A plain member still gets a "Leave" button on their own
 * row (self-removal is always allowed, subject to the "not the last owner"
 * rule the API enforces).
 */
export function OrgMembers({
  orgHandle,
  initialMembers,
  viewerHandle,
  viewerRole,
}: {
  orgHandle: string;
  initialMembers: OrgMemberRow[];
  viewerHandle?: string;
  viewerRole: OrgRole | null;
}) {
  const [members, setMembers] = useState<OrgMemberRow[]>(initialMembers);
  const [addHandle, setAddHandle] = useState("");
  const [addRole, setAddRole] = useState<OrgRole>("member");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busyHandle, setBusyHandle] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const canManage = viewerRole === "owner" || viewerRole === "admin";

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const handle = addHandle.trim().toLowerCase();
    if (!handle) {
      setAddError("Enter a user handle.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgHandle}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, role: addRole }),
      });
      if (!res.ok) {
        setAddError(await readError(res, `Failed to add member (${res.status}).`));
        return;
      }
      const data = (await res.json()) as { members: OrgMemberRow[] };
      setMembers(data.members);
      setAddHandle("");
      setAddRole("member");
    } catch {
      setAddError("Network error while adding member. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(handle: string, role: OrgRole) {
    setBusyHandle(handle);
    setRowError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgHandle}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, role }),
      });
      if (!res.ok) {
        setRowError(await readError(res, `Failed to update role (${res.status}).`));
        return;
      }
      const data = (await res.json()) as { members: OrgMemberRow[] };
      setMembers(data.members);
    } catch {
      setRowError("Network error while updating role. Try again.");
    } finally {
      setBusyHandle(null);
    }
  }

  async function handleRemove(handle: string, isSelf: boolean) {
    const confirmMessage = isSelf
      ? "Leave this organization?"
      : `Remove @${handle} from this organization?`;
    if (!window.confirm(confirmMessage)) return;

    setBusyHandle(handle);
    setRowError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgHandle}/members/${handle}`, { method: "DELETE" });
      if (!res.ok) {
        setRowError(await readError(res, `Failed to remove member (${res.status}).`));
        return;
      }
      setMembers((prev) => prev.filter((m) => m.handle !== handle));
    } catch {
      setRowError("Network error while removing member. Try again.");
    } finally {
      setBusyHandle(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {rowError && <p className="text-sm text-danger">{rowError}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left">
              <th className="px-4 py-2 font-medium text-fg-muted">Member</th>
              <th className="px-4 py-2 font-medium text-fg-muted">Role</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = viewerHandle === m.handle;
              const canEditThisRow = canManage;
              return (
                <tr key={m.handle} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-fg">
                    @{m.handle}
                    {isSelf && <span className="ml-1.5 text-xs text-fg-subtle">(you)</span>}
                  </td>
                  <td className="px-4 py-2">
                    {canEditThisRow ? (
                      <select
                        value={m.role}
                        disabled={busyHandle === m.handle}
                        onChange={(e) => handleRoleChange(m.handle, e.target.value as OrgRole)}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg disabled:opacity-60"
                      >
                        {ORG_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="capitalize text-fg-muted">{m.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(canManage || isSelf) && (
                      <button
                        type="button"
                        disabled={busyHandle === m.handle}
                        onClick={() => handleRemove(m.handle, isSelf)}
                        className="rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Add member (user handle)</label>
            <input
              type="text"
              value={addHandle}
              onChange={(e) => setAddHandle(e.target.value)}
              placeholder="handle"
              className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Role</label>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as OrgRole)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            >
              {ORG_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add"}
          </button>
          {addError && <p className="w-full text-sm text-danger">{addError}</p>}
        </form>
      )}
    </div>
  );
}
