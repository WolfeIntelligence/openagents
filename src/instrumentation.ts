// Next.js instrumentation hook (G-O6 in docs/AUDIT-2026-09.md). See
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation.
//
// `register()` is required to be exported for Next.js to load this file at all, but
// there is nothing to initialize eagerly here — captureError() in `src/lib/monitoring.ts`
// reads SENTRY_DSN lazily on every call, so there's no client/SDK object to construct
// up front. Kept as a documented no-op rather than omitted, so it's obvious this file
// is intentionally minimal and not a half-finished integration.
export function register() {}

export const onRequestError: import("next").Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  const { captureError } = await import("@/lib/monitoring");
  captureError(err, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
