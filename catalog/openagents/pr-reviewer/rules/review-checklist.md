# Review Checklist

Applied in this order during Step 3 of `WORKFLOW.md`. Each item: check it, and if it
fails, record a finding with file:line, why it matters, and a fix.

## 1. Correctness

- [ ] Does the code do what the PR description claims?
- [ ] Are edge cases handled: empty input, null/undefined, zero, negative numbers,
      very large input, empty collections, duplicate entries?
- [ ] Off-by-one errors in loops, slices, pagination, and range checks.
- [ ] Error handling: are errors caught at the right layer, logged with enough context
      to debug, and not silently swallowed (empty `catch` blocks)?
- [ ] Async correctness: unhandled promise rejections, missing `await`, race conditions
      between concurrent operations on shared state.
- [ ] Are new branches (if/switch) exhaustive, or is there a sensible default/`else`?
- [ ] Does the change match the existing behavior contract, or does it silently change
      a function's semantics in a way that breaks callers (see blast-radius check)?
- [ ] State mutations: is shared/mutable state changed safely, or could two callers
      stomp on each other?

## 2. Security

- [ ] **Secrets**: no hardcoded API keys, passwords, tokens, or connection strings —
      including in test fixtures and comments.
- [ ] **Input validation**: is all external input (HTTP request bodies, query params,
      file uploads, CLI args, env vars) validated/sanitized before use, not just typed?
- [ ] **Injection**: SQL/NoSQL built via string concatenation instead of parameterized
      queries; shell commands built from unsanitized input; unsafe deserialization.
- [ ] **AuthZ/AuthN**: does every new/changed endpoint or mutation check that the
      *current* user is allowed to do *this specific* thing (not just "is logged in")?
      Watch for IDOR — trusting a client-supplied ID without an ownership check.
- [ ] **Output encoding**: user-controlled data rendered into HTML/JS/SQL/shell without
      escaping (XSS, injection).
- [ ] **Dependency hygiene**: new dependencies — are they widely used, actively
      maintained, and pinned? Flag any with known CVEs if that's checkable.
- [ ] **Logging PII**: are emails, tokens, full names, addresses, or other personal data
      being logged in plaintext where they shouldn't be?
- [ ] **Crypto**: no custom crypto, no MD5/SHA1 for passwords, no ECB mode, secrets
      compared with constant-time comparison where timing matters.

## 3. Tests

- [ ] New behavior has a test that would fail without the change (see Step 4 of the
      workflow for how to verify this, not just assume it).
- [ ] Bug fixes include a regression test reproducing the original bug.
- [ ] Tests cover the edge cases identified in the Correctness section, not just the
      happy path.
- [ ] No weakened assertions, increased timeouts, or skipped tests introduced to make
      CI green.
- [ ] Test names describe behavior ("returns 404 when user not found"), not
      implementation ("calls getUser").

## 4. Performance

- [ ] N+1 queries: a loop that issues one DB/API call per iteration instead of a
      single batched call.
- [ ] Unbounded queries/loops: pagination missing on a list endpoint, `SELECT *`
      without a `LIMIT` on a table expected to grow.
- [ ] Unnecessary re-computation: expensive work inside a render loop, a hot path, or
      repeated inside a request handler instead of cached/memoized.
- [ ] Big-O regressions: an O(n) lookup replaced with O(n²) (e.g. `.includes()` inside
      a loop over a large array instead of a Set/Map).
- [ ] Resource leaks: unclosed file handles, DB connections, listeners, or timers.
- [ ] For hot paths only — don't demand micro-optimization of code that runs once at
      startup or in an admin-only, low-traffic path.
