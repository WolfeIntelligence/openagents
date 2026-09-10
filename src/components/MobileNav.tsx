"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { NAV_LINKS } from "@/components/NavLinks";

interface MobileNavProps {
  /** Whether a session exists (drives the account-vs-sign-in entry). */
  signedIn: boolean;
  /** Provider-derived handle, only present when known (see B12c). */
  handle?: string;
  /** Display name, used as a fallback label when there's no handle. */
  name?: string | null;
  /** Server action that signs the user out; only used when `signedIn`. */
  onSignOut?: () => Promise<void>;
}

/**
 * Mobile navigation disclosure. Renders as a native `<details>/<summary>` so the
 * links work with zero JS (the browser shows/hides the panel on its own); this
 * component progressively enhances that with ARIA state syncing, a focus trap,
 * Escape-to-close, close-on-link-click, and a body scroll lock while open.
 */
export function MobileNav({ signedIn, handle, name, onSignOut }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Keep React state in sync with the native <details> open state, however it
  // changed (click, keyboard activation of the summary, or our own script).
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const onToggle = () => setOpen(details.open);
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);

  const closePanel = useCallback((returnFocus: boolean) => {
    if (detailsRef.current) detailsRef.current.open = false;
    setOpen(false);
    if (returnFocus) summaryRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    firstFocusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (event.key === "Tab" && panel) {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePanel]);

  return (
    <details ref={detailsRef} className="md:hidden">
      <summary
        ref={summaryRef}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Menu"
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-border text-fg hover:border-border-strong [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4" aria-hidden="true">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
        </svg>
      </summary>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-bg/60"
          aria-hidden="true"
          onClick={() => closePanel(true)}
        />
      )}

      <div
        id={panelId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-x-4 top-[4.25rem] z-50 rounded-lg border border-border bg-bg-elevated p-3 shadow-lg"
      >
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => closePanel(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
          {signedIn ? (
            <>
              {handle ? (
                <Link
                  href={`/u/${handle}`}
                  onClick={() => closePanel(false)}
                  className="rounded-md px-3 py-2 font-mono text-sm font-medium text-fg hover:bg-surface-hover"
                >
                  @{handle}
                </Link>
              ) : (
                name && (
                  <span className="px-3 py-2 text-sm font-medium text-fg">{name}</span>
                )
              )}
              <Link
                href="/purchases"
                onClick={() => closePanel(false)}
                className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                Purchases
              </Link>
              <Link
                href="/settings/payouts"
                onClick={() => closePanel(false)}
                className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                Payouts
              </Link>
              {onSignOut && (
                <form
                  action={async () => {
                    closePanel(false);
                    await onSignOut();
                  }}
                >
                  <button
                    type="submit"
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    Sign out
                  </button>
                </form>
              )}
            </>
          ) : (
            <Link
              href="/signin"
              onClick={() => closePanel(false)}
              className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}
