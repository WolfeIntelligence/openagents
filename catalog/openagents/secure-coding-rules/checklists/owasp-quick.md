# OWASP Quick Checklist

A fast pass mapped to the OWASP Top 10 (2021) categories, for use before shipping code
that touches auth, data access, or external input. Not exhaustive — see `RULES.md` for
the underlying rules this checklist samples from.

- [ ] **A01 Broken Access Control** — every endpoint/mutation checks the current actor
      owns/may access the specific resource, not just that they're logged in.
- [ ] **A02 Cryptographic Failures** — no secrets in code/logs; passwords hashed with
      bcrypt/scrypt/argon2; TLS used for data in transit; no home-grown crypto.
- [ ] **A03 Injection** — all queries parameterized; no string-built SQL/shell
      commands from untrusted input; template auto-escaping intact.
- [ ] **A04 Insecure Design** — authz/rate-limit/abuse considerations were part of the
      design, not bolted on after; default-deny on new capabilities.
- [ ] **A05 Security Misconfiguration** — no debug mode/verbose errors in production
      paths; default credentials changed; unnecessary features/ports disabled.
- [ ] **A06 Vulnerable & Outdated Components** — new/bumped dependencies checked for
      known CVEs and maintenance status.
- [ ] **A07 Identification & Authentication Failures** — session tokens are
      secure/httpOnly/sameSite where applicable; no auth bypass paths left from
      debugging; brute-force protection on login/reset flows.
- [ ] **A08 Software & Data Integrity Failures** — no untrusted deserialization; CI/CD
      and dependency sources are verified, not arbitrary.
- [ ] **A09 Logging & Monitoring Failures** — security-relevant events (auth failures,
      access-control denials) are logged without leaking secrets/PII; logs are
      actually reachable by someone who'd act on them.
- [ ] **A10 Server-Side Request Forgery (SSRF)** — any server-side "fetch this URL"
      feature validates/restricts the target (no fetching internal/metadata
      endpoints from user-supplied URLs).
