# Research Brief

Turns an open question into a sourced, skimmable brief. Decomposes the question,
builds a search plan that deliberately looks for disconfirming evidence (not just
confirming), grades every source, tracks every claim to its source(s) in a claim
ledger, and writes up findings with honest confidence levels — distinguishing
well-corroborated claims from single-source or disputed ones.

## When to use

- Answering an open-ended "should we / is it true that / what's the state of X"
  question that deserves more than an off-the-cuff answer.
- Producing something shareable — a brief a reader can check, not just a paragraph of
  assertions.
- Any research task where being wrong confidently is worse than being appropriately
  uncertain (technical decisions, due diligence, fact-checking).

## Install

```bash
npx openagents-cli add openagents/research-brief
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/research-brief/` |
| `cursor` | `.cursor/rules/research-brief/` |
| `codex` | `.codex/skills/research-brief/` |
| `openai-agents` | `.openai-agents/research-brief/` |
| `generic` | `.openagents/research-brief/` |

## Inputs

| name | type | required | default | description |
|---|---|---|---|---|
| `question` | string | yes | — | The question or claim to research |
| `depth` | string | no | `standard` | `quick` (3-5 sources), `standard` (6-12), `deep` (12+, diverse source types) |
| `audience` | string | no | — | Who the brief is for, to calibrate depth/framing |

## Example run

```
> Write a research brief on whether we should adopt library X over Y for our queue.
```

The agent decomposes the question (capability differences, maintenance health, known
limitations, migration cost), searches for both supporting *and* disconfirming
evidence per sub-question, grades each source (`source-grading.md`), builds a claim
ledger, and writes the result with `templates/brief.md` — leading with a direct
bottom-line answer and an honest confidence rating.

## Files

- `SKILL.md` — the decompose/search/grade/ledger/write procedure (entry point).
- `source-grading.md` — the A–F source reliability scale and rules for using it.
- `templates/brief.md` — the brief output format.

## Limitations

- Quality depends on what's actually searchable/accessible in the runtime environment;
  paywalled or non-indexed primary sources may be represented only via secondary
  citations, noted as such.
- Does not independently verify claims beyond cross-referencing sources — it is not a
  substitute for expert review on highly technical or high-stakes questions.
- `deep` runs take meaningfully longer due to the larger source count and deliberate
  type diversity requirement.
