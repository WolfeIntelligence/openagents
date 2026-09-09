# Brief Template

```markdown
# <Question, restated as a title>

**Bottom line:** <the direct answer, 1-3 sentences, stated plainly>
**Confidence:** High (multiple independent A/B sources agree) | Medium (some
corroboration, or C-grade sources) | Low (single source, or sources disagree)

## Context

<1 short paragraph: why this question matters / what prompted it, if relevant>

## Findings

### <Sub-question 1, from the decomposition>

<Prose answer with inline citations, e.g. "X reduces cold-start latency by roughly
40% in typical configurations [1][2]." Distinguish well-corroborated claims from
single-source ones in the wording itself, not just the confidence line above.>

### <Sub-question 2>

...

## Where sources disagree

<If applicable — state each position and its basis, don't arbitrate artificially.
 Omit this section entirely if sources were in agreement.>

## What we couldn't confirm

<Claims that came up but couldn't be adequately sourced — worth naming so the reader
 knows what's still open, rather than silently omitting them. Omit this section if
 nothing applies.>

## Sources

1. [Title/description](url) — <type: primary/secondary>, <grade>, <date>
2. ...
```

## Notes on filling it out

- The "Bottom line" is written last but read first — don't let it drift from what the
  Findings section actually supports.
- Every source in the list should be graded per `source-grading.md`; the grade doesn't
  need to appear in the reader-facing brief itself unless the audience wants it, but it
  must exist in your working ledger.
- Keep prose tight — a brief is not a literature review. If a finding needs more than
  a paragraph, it's a sign the sub-question should be split further.
