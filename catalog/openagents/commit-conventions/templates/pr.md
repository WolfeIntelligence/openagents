# PR Description Template

```markdown
## Summary

<1-3 sentences: what changed and why. Link the issue/ticket if one exists.>

## Changes

- <bullet list of the concrete changes, grouped logically if the diff spans
  multiple areas>

## Why

<the motivation/context a reviewer needs that isn't obvious from the diff alone —
 e.g. "we chose X over Y because...">

## Testing

- [ ] <how this was verified — unit tests added/passing, manual steps taken,
      screenshots for UI changes>

## Breaking changes

<"None" if none, otherwise describe the break and the migration path>

## Screenshots (if UI-facing)

<before/after, or omit this section entirely if not applicable>
```

## Guidance

- **Summary** should stand alone — someone skimming a PR list should understand the
  change from the summary without opening the diff.
- **Changes** is a bullet list, not prose, so a reviewer can scan it.
- **Testing** should describe what was actually done (ran the suite, manually clicked
  through X, added a regression test) — "tested locally" alone isn't enough detail to
  be useful to a reviewer.
- Omit sections that don't apply (e.g. no screenshots section for a backend-only
  change) rather than leaving them as empty placeholders.
- Keep the PR title itself in the same `type(scope): summary` format as commits when
  the PR is a single logical change (most PRs); for PRs squash-merged from many small
  commits, the title becomes the eventual squash commit message, so hold it to the
  same bar.
