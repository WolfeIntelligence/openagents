# TypeScript review pass

Run over the diff before calling a change done. Each item is a question with a yes or
no answer.

## Types

- [ ] Any new `any`? Is `unknown` plus narrowing possible instead?
- [ ] Any new `!` or `as`? What guarantees it, and is that guarantee in the type system?
- [ ] Does every new function's return type cover the undefined and error paths?
- [ ] Is external data validated at the boundary rather than cast?

## Errors

- [ ] Any empty catch, or catch that only logs? Is that deliberate and explained?
- [ ] Does any error path swallow the cause?
- [ ] Can a caller distinguish "no result" from "failed to look"?

## Structure

- [ ] Is any new abstraction used more than once?
- [ ] Any new exported symbol that only the module itself uses?
- [ ] Does the new code read like the file around it?

## Async

- [ ] Any unawaited promise? Deliberate?
- [ ] Any sequential await over independent calls?

## Tests

- [ ] Does a new test fail if the change is reverted? If not, it is not testing the change.
- [ ] Is the error path tested, not just the happy path?
