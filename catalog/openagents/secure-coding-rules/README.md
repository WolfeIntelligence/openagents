# Secure Coding Rules

A CLAUDE.md/AGENTS.md-style rules set covering secrets handling, input validation,
injection prevention, authorization, dependency hygiene, and PII logging. Unlike a
workflow, this doesn't run as a procedure — it's loaded as standing rules the agent
follows on every edit for the life of the project.

## When to use

- Load into any project as baseline rules, especially ones handling user data, auth,
  or payments.
- Pair with `pr-reviewer` — these rules constrain how code is written; the reviewer
  checklist catches what slips through.
- Good as an always-on rules file (`.claude/rules/`, a `CLAUDE.md` include, a Cursor
  rule) rather than something invoked per-task.

## Install

```bash
npx openagents-cli add openagents/secure-coding-rules
```

| Runtime | Installed to |
|---|---|
| `claude-code` | `.claude/skills/secure-coding-rules/` |
| `cursor` | `.cursor/rules/secure-coding-rules/` |
| `codex` | `.codex/skills/secure-coding-rules/` |
| `openai-agents` | `.openai-agents/secure-coding-rules/` |
| `langgraph` | `.langgraph/secure-coding-rules/` |
| `generic` | `.openagents/secure-coding-rules/` |

For `claude-code`/`cursor`, consider also referencing `RULES.md` directly from your
project's own `CLAUDE.md`/rules file (e.g. `@.claude/skills/secure-coding-rules/RULES.md`)
so it's always in context rather than only when explicitly invoked.

## Inputs

None — this package has no runtime parameters. It's a static rules file.

## Example run

```
> Load the secure-coding-rules and then implement the new /api/transfer endpoint.
```

The agent applies the rules while writing the endpoint: parameterized queries,
resource-level authorization on the transfer target, input validation on amount/
currency, no logging of account numbers, and no secrets in the diff.

## Files

- `RULES.md` — the rules themselves (entry point): secrets, input validation,
  injection prevention, authz/authn, dependency hygiene, logging/PII.
- `checklists/owasp-quick.md` — a fast pre-ship pass mapped to the OWASP Top 10.

## Limitations

- Rules, not enforcement — nothing here runs a scanner or blocks a commit; pair with
  static analysis / secret-scanning tooling in CI for automated enforcement.
- Written to be language/framework-agnostic; teams with a specific stack (e.g. a
  particular ORM) may want to extend it with stack-specific examples.
- Not a substitute for a real security review on high-risk changes (auth redesigns,
  crypto, payment flows).
