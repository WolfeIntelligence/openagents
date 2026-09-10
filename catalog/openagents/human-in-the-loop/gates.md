# Actions by reversibility

The gate an action needs follows from how hard it is to undo, not from how it feels.

## Free, no gate

Reads, searches, analysis, and anything scoped to a scratch directory. Local file
edits in a dirty working tree already under version control.

## Confirm once, describe and ask

Recoverable, but annoying or visible to others:

- Committing, pushing to a shared branch, opening a PR
- Installing dependencies, changing lockfiles
- Writing outside the working directory
- Creating cloud resources that cost money at a small rate
- Any first write to a system the agent has only read from before

## Confirm with detail, show exactly what will happen

Hard to undo, or visible to people outside the room:

- Sending anything: email, message, comment, calendar invite
- Publishing, deploying, releasing, merging to a default branch
- Schema migrations, bulk updates, data deletion with a backup
- Spending against a payment method on file
- Changing permissions, access, or configuration others depend on

Show the rendered result, the actual message text, the actual diff, the actual row
count, not a description of it.

## Never automate, hand to the human

The agent prepares, a person executes:

- Entering credentials, payment details, or government identifiers
- Deleting data with no recovery path, including emptying a trash
- Moving money
- Anything that authenticates as someone, or creates an account
- Accepting legal terms

For these, produce everything up to the final click, then hand over with clear
instructions. "I have filled in the form, review and submit" is the right ending.

## Escalating autonomy

`strict` moves the confirm-once tier up to confirm-with-detail. `trusted` drops
confirm-once to no gate. Neither level ever touches the last tier. Those stay manual
at every autonomy setting.
