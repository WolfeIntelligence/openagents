# Python review pass

## Failures

- [ ] Any bare `except` or `except Exception` that continues?
- [ ] Any exception caught and dropped without a reason?
- [ ] Is the cause chained on every re-raise?
- [ ] Can a caller tell "no result" from "lookup failed"?

## Traps

- [ ] Any mutable default argument?
- [ ] Any collection mutated while iterated?
- [ ] Is every opened resource closed by a `with`?
- [ ] Any truthiness check where zero or empty is a valid value?

## Types

- [ ] Do the hints admit `None` everywhere it can occur?
- [ ] Any dict with a fixed known shape that should be a dataclass?

## Dependencies

- [ ] Anything added that the standard library already does?
- [ ] Anything added for a single function?

## Tests

- [ ] Does a new test fail if the change is reverted?
- [ ] Is the raising path covered, not only the happy path?
