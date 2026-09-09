# Destructive Actions Policy

Classification rules used by the pre-action check in `HARNESS.md`. When an action
doesn't clearly match a category, classify it at the *more* cautious level — treating
a borderline reversible action as destructive costs one extra confirmation; treating a
destructive action as reversible can be unrecoverable.

## Read-only (no gate)

- Reading/searching files, listing directories, `git status`/`git log`/`git diff`.
- GET requests / read-only API calls.
- Running tests, linters, type checkers (unless they have a `--fix`/write mode enabled).
- Querying a database with `SELECT`-only statements.

## Reversible-write (proceeds, logged)

- Editing or creating a file that's tracked in version control (recoverable via git
  history/diff).
- Creating a new branch.
- Writing to a scratch/temp directory.
- Adding a row / creating a new resource via an API, where the created resource can be
  deleted or is clearly low-stakes (e.g. a draft, a test-environment record).

## Destructive / irreversible (requires confirmation gate)

- **Deleting** anything without a recoverable trash/soft-delete: files, database rows,
  cloud resources (buckets, instances, secrets), branches with unmerged commits.
- **Force-pushing** or rewriting shared git history (`push --force` to a shared
  branch, `rebase` on public history, `git reset --hard` that discards uncommitted
  work).
- **Schema/infrastructure changes** with data-loss potential: dropping/altering a
  table column, changing a database's access controls, modifying DNS, revoking API
  keys or access grants, changing IAM/permission policies.
- **External communication**: sending an email, chat message, or notification to
  anyone outside the immediate operator; posting/publishing public content; opening
  or merging a PR without review when the repo's norm is to require review.
- **Financial actions**: any purchase, trade, transfer, subscription change, or refund
  — regardless of amount.
- **Bulk operations**: anything matching a wildcard/glob/`--all`/`--force` flag that
  could affect more targets than individually reviewed (e.g. "delete all branches
  matching `feature/*`") — the confirmation gate must state the actual resolved count
  of affected items, not just the pattern.
- **Credential/secret handling**: rotating, revoking, or regenerating any credential
  that other systems depend on.
- **Overwriting without merge**: replacing a file/resource wholesale in a way that
  discards concurrent changes (e.g. a force-overwrite that could clobber another
  process's write).

## Never auto-escalate a classification downward

An action doesn't become "just reversible-write" because the operator seems rushed, or
because a previous similar action was approved — each destructive action gets its own
gate, every time, per `HARNESS.md`.
