# API review checklist

## Model

- [ ] Do resource names match user vocabulary rather than table names?
- [ ] Can a typical screen be served without more than two or three calls?
- [ ] Is one relationship style used consistently throughout?

## Naming

- [ ] One casing convention, no exceptions?
- [ ] Collections plural, members singular?
- [ ] Any verbs in paths that should be methods?
- [ ] Any name that encodes a current implementation detail?

## Errors

- [ ] Stable error code on every error, separate from the status?
- [ ] Does each message say what the client should do?
- [ ] Do validation errors identify the offending field?
- [ ] 401 versus 403 used correctly?
- [ ] Any 200 response carrying an error?
- [ ] Any internal detail exposed in an error body?

## Collections

- [ ] Pagination on every list, including short ones?
- [ ] Cursor-based where the underlying data changes?
- [ ] Maximum page size documented and enforced?
- [ ] Filter and sort parameters finite and documented?

## Evolution

- [ ] Is the versioning strategy written down?
- [ ] Is every required field genuinely required forever?
- [ ] Is enum extensibility documented?
- [ ] Would adding a field break a well-behaved client?

## Permanent details

- [ ] Timestamps ISO 8601 with offset?
- [ ] Money in integer minor units with a currency?
- [ ] Identifiers opaque?
- [ ] Null versus absent documented?
- [ ] Idempotency key on retryable unsafe methods?
- [ ] Rate limits documented, with headers?

## Documentation

- [ ] Does every endpoint have a real example request and response?
- [ ] Are the error cases documented, not just the success case?
- [ ] Could someone integrate from the docs alone, without reading the source?
