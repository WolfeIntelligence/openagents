// Minimal error-observability sink (G-O6 in docs/AUDIT-2026-09.md).
//
// No SDK dependency on purpose: `@sentry/nextjs` pulls in instrumentation that fights
// with the zero-env-vars guarantee (see next.config.ts / README) and adds a few hundred
// KB to the server bundle for a feature most self-hosters won't turn on. Instead:
//   - Every error is logged as one line of structured JSON to stderr, always, so
//     `vercel logs` / `docker logs` / journalctl are a working observability backend
//     with zero configuration.
//   - When SENTRY_DSN is set, the same error is also POSTed to Sentry's minimal
//     "store" endpoint (the same wire format the SDKs use under the hood), by hand,
//     with a short timeout, best-effort. A slow or unreachable Sentry never delays or
//     fails the request that triggered the error.
//
// Safe to import with zero env vars: captureError() only touches the network when
// SENTRY_DSN is set, and never throws.

export interface ErrorContext {
  [key: string]: unknown;
}

const SENTRY_TIMEOUT_MS = 2000;

/** `https://<publicKey>@<host>/<projectId>` -> store endpoint + auth header, or
 *  null if SENTRY_DSN is unset or malformed. Never throws. */
function parseSentryDsn(dsn: string | undefined): { url: string; publicKey: string } | null {
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    const publicKey = parsed.username;
    const projectId = parsed.pathname.replace(/^\//, "");
    if (!publicKey || !projectId || !parsed.host) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

async function sendToSentry(err: unknown, context: ErrorContext): Promise<void> {
  const target = parseSentryDsn(process.env.SENTRY_DSN);
  if (!target) return;

  const message = err instanceof Error ? err.message : String(err);
  const stacktrace =
    err instanceof Error && err.stack
      ? {
          frames: err.stack
            .split("\n")
            .slice(1)
            .map((line) => ({ filename: line.trim() })),
        }
      : undefined;

  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "openagents.monitoring",
    exception: {
      values: [
        {
          type: err instanceof Error ? err.name : "Error",
          value: message,
          ...(stacktrace ? { stacktrace } : {}),
        },
      ],
    },
    extra: context,
  };

  const auth = [
    "Sentry sentry_version=7",
    `sentry_client=openagents-monitoring/1.0`,
    `sentry_key=${target.publicKey}`,
  ].join(", ");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENTRY_TIMEOUT_MS);
  try {
    await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": auth,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Best-effort: a down or slow Sentry must never surface as an app-level failure.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Records an error: always as one structured JSON line on stderr, and — when
 * SENTRY_DSN is configured — also as a best-effort event POSTed to Sentry.
 * Never throws, and never awaits the network call longer than ~2s.
 */
export function captureError(err: unknown, context: ErrorContext = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  try {
    console.error(
      JSON.stringify({
        level: "error",
        message,
        stack,
        context,
        time: new Date().toISOString(),
      })
    );
  } catch {
    // Fall back to the plain console if context isn't JSON-serializable.
    console.error("[monitoring] failed to serialize error context", err);
  }

  // Fire-and-forget: callers (onRequestError) must not await this.
  void sendToSentry(err, context).catch(() => {});
}
