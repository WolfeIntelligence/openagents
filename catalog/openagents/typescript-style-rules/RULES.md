# TypeScript Style Rules

Rules are ordered by how much damage breaking them does. Each one names the failure it
prevents, because a rule without a reason gets discarded the first time it is
inconvenient.

## Types must be honest

1. **Never use `any` to silence an error.** If the type is genuinely unknown, use
   `unknown` and narrow it. `any` does not fix the problem, it hides it until runtime.
2. **Never use a non-null assertion (`!`) to silence an error.** Either the value can
   be null and you must handle it, or it cannot and the type is wrong. Fix the type.
3. **A function's return type must describe every path.** If it can return undefined,
   say so. A signature that lies is worse than no signature.
4. **Do not widen a type to make a call site compile.** Narrow at the boundary instead.
5. **Parse external data, do not cast it.** Anything from a network, a file, or a
   database is `unknown` until validated. A cast on untrusted input is a runtime crash
   waiting for the right payload.

## Errors

6. **Never write an empty catch.** If a failure is genuinely ignorable, say why in a
   comment. An unexplained empty catch is indistinguishable from a bug.
7. **Catch narrowly.** Wrap the call that can fail, not the whole function body.
8. **Do not convert an error into a falsy return value** unless every caller checks it.
   Silent failure propagates further than a throw.
9. **Preserve the cause.** When rethrowing, use `{ cause: err }` rather than dropping
   the original and its stack.

## Structure

10. **Do not create an abstraction for one caller.** Two callers is a coincidence,
    three is a pattern. The premature interface costs more than the duplication.
11. **Do not add a config option nobody asked for.** Every option is a branch that must
    be tested and a decision the reader must understand.
12. **Keep the module boundary narrow.** Export what callers need. An exported internal
    becomes someone's dependency the moment it is visible.
13. **Match the file you are editing.** Its naming, its error style, its import order.
    Consistency inside a file beats your preference.

## Async

14. **Never leave a promise unawaited** unless you deliberately want fire-and-forget,
    in which case attach a catch and say so in a comment.
15. **Do not use `Promise.all` where one failure should not cancel the rest.** Use
    `allSettled` and handle each result.
16. **Do not `await` in a loop when the calls are independent.** Collect the promises
    and await once.

## Comments

17. **Comment the why, never the what.** The code says what it does. Explain the
    constraint, the workaround, the reason for the surprising choice.
18. **Do not narrate a change.** `// changed to fix bug` is noise the moment it lands.
    That belongs in the commit message.
19. **Delete commented-out code.** Version control already has it.

## What good looks like

```ts
// The upstream API returns 200 with an error body when the key is expired,
// so a status check alone is not enough here.
const parsed = ResponseSchema.safeParse(await res.json());
if (!parsed.success) {
  throw new Error(`malformed response from ${url}`, { cause: parsed.error });
}
```

Honest types, narrow catch, external data parsed, and a comment that explains a thing
the reader could not have guessed.
