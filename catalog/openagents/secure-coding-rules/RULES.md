# Secure Coding Rules

A CLAUDE.md/AGENTS.md-style rules set. Load this alongside a project's own rules; it
constrains how code is written, not what feature to build. These rules apply to all
code the agent writes or edits, not only code explicitly flagged as "security-sensitive"
— the majority of real vulnerabilities show up in ordinary CRUD code, not crypto code.

## Secrets

- Never hardcode API keys, passwords, tokens, connection strings, or private keys in
  source, tests, fixtures, or comments — including "just for now" or "I'll remove it
  later." Use environment variables or a secrets manager.
- Never print, log, or echo a secret's value, even for debugging. Log that a secret was
  loaded/missing, not its contents.
- Never commit `.env` files with real values. Check `.gitignore` covers them before
  creating one; if it doesn't, add it before writing the file.
- When a secret is genuinely needed in a prompt/example, use an obvious placeholder
  (`sk-...REDACTED...`, `<YOUR_API_KEY>`), never a real-looking fake that could be
  mistaken for a leaked credential.
- Rotate-on-suspicion: if a secret is found committed to history, treat it as
  compromised — flag it for rotation, don't just delete the line in a new commit
  (history still has it).

## Input validation

- Validate all external input at the boundary: HTTP request bodies/params/headers,
  query strings, file uploads, CLI arguments, environment variables, webhook payloads,
  and data read from a queue. "External" means anything not constructed by this
  process in this request.
- Validate shape *and* semantics: a string field being present isn't enough — check
  length bounds, allowed character sets/formats, and business-rule bounds (e.g.
  quantity > 0).
- Prefer allow-lists over deny-lists (enumerate what's valid, don't try to enumerate
  every invalid thing).
- Never trust a client-supplied ID as sufficient authorization to act on that resource
  — validation confirms shape, not permission (see Authorization below).
- Reject invalid input with a clear error; don't silently coerce/truncate it into
  something "close enough."

## Injection prevention

- SQL/NoSQL: always use parameterized queries or an ORM's query builder. Never build a
  query by concatenating/interpolating untrusted input into a query string.
- Shell commands: avoid building commands from untrusted input at all where possible;
  when unavoidable, use an API that passes arguments as an array (not a shell string)
  and never pass untrusted input through `sh -c`/`shell: true`.
- Deserialization: don't deserialize untrusted data with formats/libraries that can
  execute code (e.g. Python `pickle`, unsafe YAML loaders) — use safe/restricted
  loaders for untrusted input.
- Template rendering: use the templating engine's auto-escaping; never mark untrusted
  input as "safe"/raw HTML without a specific, reviewed reason.

## Authorization & authentication

- Every new or modified endpoint, mutation, or background job that acts on a specific
  resource must check that the *current* actor is allowed to act on *that specific*
  resource — not just that they're authenticated. Watch for IDOR: a client-supplied ID
  is not proof of ownership.
- Enforce authorization on the server/backend, never rely on a client (UI hiding a
  button, a mobile app not showing a menu item) as the actual control.
- Default to deny: new routes/fields start unauthorized-by-default and are opened up
  explicitly, not the reverse.
- Session tokens: use secure, httpOnly, sameSite cookies for web sessions where
  applicable; never store auth tokens in localStorage if httpOnly cookies are an
  option, since localStorage is readable by any script (XSS blast radius).
- Passwords: hash with a modern algorithm (bcrypt/scrypt/argon2) with a proper work
  factor. Never MD5/SHA1/SHA256 alone (no salt/stretch) for password storage.

## Dependency hygiene

- Before adding a new dependency: check it's actively maintained (recent releases),
  reasonably popular/widely used, and has no known critical CVEs for the version being
  added.
- Pin versions (exact or narrow range) in the lockfile; don't introduce a dependency
  with an unbounded version range.
- Prefer the standard library or an existing dependency already in the project over
  adding a new one for trivial functionality.
- When updating a dependency across a major version, actually read the changelog for
  breaking/security-relevant changes rather than bumping blindly.

## Logging & PII

- Never log full credentials, tokens, session IDs, or secrets — not even at debug
  level.
- Treat as PII and avoid logging in plaintext unless there's a specific, reviewed need:
  full names, email addresses, phone numbers, physical addresses, government IDs,
  precise geolocation, health/financial data. Mask or omit by default (e.g. log a user
  ID, not their email).
- Structured logs should have a defined field allow-list for what's safe to include;
  don't `console.log`/`print` an entire request/response object that may contain
  sensitive fields.
- Error messages returned to end users should not leak internal details (stack traces,
  file paths, SQL, internal hostnames) — log the detail internally, return a generic
  message externally.

## When in doubt

If a change touches auth, payments, PII, or crypto and the right approach isn't
obvious from these rules, say so explicitly and ask rather than guessing — these are
exactly the categories where a quiet wrong guess becomes an incident. See
`checklists/owasp-quick.md` for a fast pre-ship pass over the OWASP Top 10 categories.
