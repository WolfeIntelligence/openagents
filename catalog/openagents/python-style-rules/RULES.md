# Python Style Rules

Ordered by how much damage breaking them does.

## Failures must be visible

1. **Never write a bare `except:` or `except Exception:` that continues.** It catches
   the typo in the line above it too. Catch the specific exception you expect.
2. **Never swallow an exception silently.** If ignoring it is right, log it or comment
   why in one line.
3. **Do not return `None` to signal an error** in a function that also returns `None`
   legitimately. Raise, or return an explicit result type.
4. **Chain exceptions.** `raise X from err`. Dropping the cause discards the traceback
   that explains the failure.
5. **Validate at the boundary.** Data from a network, a file, or a subprocess is
   untrusted. Check it once on the way in, not defensively at every use.

## The obvious traps

6. **No mutable default arguments.** `def f(x=[])` shares one list across every call.
   Use `None` and build inside.
7. **Do not mutate a collection you are iterating.** Build a new one.
8. **Close what you open.** Use `with`, always, including for subprocesses and locks.
9. **Compare with `is` only for `None`, `True`, `False`.** Not for strings or numbers.
10. **Beware truthiness on containers and numbers.** `if not count` is true for zero.
    Say `if count is None` when that is what you mean.

## Types and data

11. **Type hints must be honest.** If it can return `None`, the hint says `| None`.
    A wrong hint is worse than none, because tools trust it.
12. **Prefer a dataclass or NamedTuple to a dict** for anything with a fixed shape.
    A dict of known keys is a class that has not admitted it yet.
13. **Do not use a tuple with more than three elements as a return value.** Name the
    fields.

## Dependencies

14. **Do not add a dependency for something the standard library does.** `pathlib`,
    `json`, `itertools`, `dataclasses`, `subprocess` cover an enormous amount.
15. **Do not add a dependency for one function.** Copy the twenty lines, with credit.
16. **Pin what you add**, and say in the commit why it is needed.

## Structure

17. **Functions do one thing and are named after it.** A name with `and` in it is two
    functions.
18. **No side effects at import time.** No network calls, no file writes, no
    environment mutation in module scope. Import must be free.
19. **Match the file you are editing.** Its conventions win over your preferences.

## Comments

20. **Comment the why.** The constraint, the workaround, the reason for the odd choice.
21. **Docstring the contract**, not the implementation: what it takes, what it returns,
    what it raises.
22. **Delete commented-out code.**

## What good looks like

```python
# The vendor API returns 200 with an empty body on rate limit, so a status
# check is not enough to tell success from throttling here.
try:
    payload = json.loads(response.text)
except json.JSONDecodeError as err:
    raise UpstreamError(f"non-JSON body from {url}") from err
```

Specific exception, cause preserved, and a comment explaining something the reader
could not have guessed from the code.
