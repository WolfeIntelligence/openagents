"use client";

import { useEffect, useRef } from "react";

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ["/"], description: "Focus search" },
  { keys: ["g", "e"], description: "Go to Explore" },
  { keys: ["g", "h"], description: "Go to Home" },
  { keys: ["g", "t"], description: "Go to Tags" },
  { keys: ["g", "c"], description: "Go to Collections" },
  { keys: ["?"], description: "Show this help" },
  { keys: ["Esc"], description: "Close suggestions or this dialog" },
];

/**
 * "Keyboard shortcuts" dialog, opened by `KeyboardShortcuts` on `?`.
 *
 * Built on the native `<dialog>` element specifically so focus trapping and
 * Escape-to-close come from the browser instead of hand-rolled JS:
 * `showModal()` traps focus and puts the dialog in the top layer, and a
 * native `cancel`/`close` event (fired for Escape, and for anything else
 * that closes the dialog) is the single place `onClose` gets called from.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      onClose();
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="oa-shortcuts-heading"
      onClick={(e) => {
        // A click on the <dialog> element itself (not its content box, which
        // stops propagation implicitly via the box model) means the backdrop
        // was clicked — close like Escape would.
        if (e.target === dialogRef.current) onClose();
      }}
      className="w-[min(24rem,90vw)] rounded-lg border border-border bg-surface p-5 text-fg backdrop:bg-black/50 open:flex open:flex-col open:gap-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="oa-shortcuts-heading" className="text-base font-semibold text-fg">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
        >
          ✕
        </button>
      </div>
      <dl className="flex flex-col gap-2.5 text-sm">
        {SHORTCUTS.map((row) => (
          <div key={row.description} className="flex items-center justify-between gap-4">
            <dt className="text-fg-muted">{row.description}</dt>
            <dd className="flex shrink-0 gap-1">
              {row.keys.map((k, i) => (
                <kbd
                  key={`${row.description}-${i}`}
                  className="rounded border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-xs text-fg"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
