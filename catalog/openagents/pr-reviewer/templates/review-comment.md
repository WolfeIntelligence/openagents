# Review Report Template

Fill in and use as the final output of the workflow (printed, or posted per Step 6).

```
## PR Review: <title> (#<number>)

**Risk tier:** High | Medium | Low
**Recommendation:** Merge as-is | Merge with changes | Needs discussion

<1-paragraph summary of what this PR does and the overall verdict>

---

### Blockers
- `path/to/file.ts:42` — <what's wrong and why it matters>
  **Fix:** <concrete suggestion>

### Major
- `path/to/file.ts:88` — <what's wrong and why it matters>
  **Fix:** <concrete suggestion>

### Minor
- `path/to/file.ts:15` — <what's wrong>
  **Fix:** <concrete suggestion>

### Nits (optional, non-blocking)
- `path/to/file.ts:5` — <style/naming/readability suggestion>

---

### Checklist summary
- Correctness: <pass / N findings>
- Security: <pass / N findings>
- Tests: <pass / N findings>
- Performance: <pass / N findings>

### Not reviewed
- <files skipped and why, e.g. generated/vendored/binary>
```

## Severity definitions

- **Blocker** — must fix before merge: breaks correctness, introduces a security
  vulnerability, or has no test coverage for critical new behavior.
- **Major** — should fix before merge: real bug risk, missing edge-case handling,
  meaningful performance regression, or a maintainability hazard in shared code.
- **Minor** — should fix, can be a fast-follow: small correctness/readability issues
  unlikely to cause incidents.
- **Nit** — optional: style, naming, formatting. Never blocks a merge on its own.

## Notes on tone

- Point at the code and the consequence, not the author. "This throws on empty input"
  reads very differently from "you forgot to handle empty input."
- Always pair a finding with a suggested fix — a comment that only says something is
  wrong without a path forward slows the author down more than it helps.
- If everything looks good, say so plainly and briefly. A short "no blockers, two
  minor nits" review is a complete review.
