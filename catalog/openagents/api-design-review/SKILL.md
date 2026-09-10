# API Design Review

Review in this order. It is roughly the order of how expensive each mistake is to fix
once a client depends on it.

## 1. The model

Get this wrong and nothing downstream saves you.

- **Do the resources match how users think, or how the database is arranged?** These are
  frequently not the same. The API is a contract with a client, not a view of your
  schema.
- **Is the grain right?** One call per screen is chatty. One call that returns
  everything is a coupling nobody can evolve.
- **Are relationships expressed consistently?** Nested paths, or ids and a second call.
  Pick one and hold it.

## 2. Naming

Permanent, and free to get right now.

- Consistent case, one convention, everywhere. Do not mix `userId` and `user_id`.
- Plural collections, singular members. `/users`, `/users/{id}`.
- No verbs in resource paths. The method is the verb.
- Names that will still be true later. `email` outlives `emailAddress2`.
- Booleans named for the positive: `enabled`, not `disabled`, and never `notDisabled`.

## 3. Errors

The most-skipped part of API design and the one clients complain about most.

- **Every error has a stable machine-readable code**, distinct from the HTTP status.
  Clients must not branch on the human-readable message.
- **The message says what to do about it**, not just what went wrong.
- **Validation errors name the field.** One error per bad field, not a sentence listing
  them.
- **Status codes are used correctly:** 400 malformed, 401 unauthenticated, 403
  authenticated but not permitted, 404 absent, 409 conflicts with current state, 422
  well-formed but semantically invalid, 429 rate limited with a `Retry-After`.
- **No 200 with an error body.** That breaks every generic client.
- **Errors never leak internals.** No stack traces, no SQL, no internal hostnames.

## 4. Collections

- **Pagination exists from day one**, even when the list is short today. Adding it later
  is a breaking change.
- **Cursor-based, not offset-based**, for anything that can change while a client pages.
- **A documented maximum page size**, enforced.
- **Filtering and sorting are explicit and finite.** An open query language is an API you
  can never change.
- **The response envelope is consistent**: items plus pagination metadata, the same
  shape on every collection.

## 5. Evolution

Decide now how this changes later.

- **How is a breaking change delivered?** Version in the path, in a header, or never.
  Whatever the answer, write it down before the first client integrates.
- **Which fields are required?** Every required field is permanent. Optional with a
  sensible default is nearly always the better call.
- **Are enums closed?** A client that switches exhaustively on your enum breaks when you
  add a value. Say in the docs whether values may be added.
- **Additive changes must be safe.** Clients ignore unknown fields, and you never
  repurpose an existing one.

## 6. Everything else that becomes permanent

- Timestamps: ISO 8601, UTC, with an offset. Never a bare local time, never epoch
  seconds where milliseconds might later be needed.
- Money: integer minor units plus a currency code. Never a float.
- Identifiers: opaque strings. A client should never parse one, and a numeric id
  encourages exactly that.
- Nullability: distinguish "absent" from "explicitly null" and document which you mean.
- Idempotency: any unsafe method a client may retry needs an idempotency key.
- Rate limits: documented, with headers a client can read before hitting them.

## Reporting

Group findings by cost to fix later, not by severity today. Lead with anything that
becomes permanent the moment a client integrates, because that is the only window to
change it for free.
