"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import {
  reduceShortcutKey,
  INITIAL_SHORTCUT_STATE,
  type ShortcutParserState,
} from "@/lib/search-client";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function focusHeaderSearch(): void {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>("[data-oa-search-input]")
  );
  // The header renders both a desktop and a mobile SearchBox at all times;
  // only one is visible (the other is `hidden`/`lg:hidden`, i.e. `display:
  // none`, which zeroes out `offsetParent`) — focus whichever one actually is.
  const visible = candidates.find((el) => el.offsetParent !== null) ?? candidates[0];
  if (visible) {
    visible.focus();
    visible.select();
  }
}

/**
 * Mounts the global keyboard shortcuts once (root layout): `/` focuses the
 * header search box, `g e`/`g h`/`g t`/`g c` navigate, `?` opens the
 * shortcuts dialog. All are ignored while the user is typing in a
 * form field (see `isTypingTarget`) or while the dialog itself is open (it
 * owns its own focus trap and Escape handling — see `ShortcutsHelp`).
 *
 * Renders only that (initially closed) dialog; everything else here is a
 * side effect wired up in `useEffect`.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const stateRef = useRef<ShortcutParserState>(INITIAL_SHORTCUT_STATE);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (helpOpen) return;
      if (isTypingTarget(e.target)) return;

      const { state, action } = reduceShortcutKey(
        stateRef.current,
        { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey },
        Date.now()
      );
      stateRef.current = state;
      if (!action) return;

      // Every recognized action fully owns the keypress — in particular this
      // stops Firefox's "quick find" from also opening on a bare "/".
      e.preventDefault();
      if (action.type === "focus-search") {
        focusHeaderSearch();
      } else if (action.type === "navigate") {
        router.push(action.href);
      } else if (action.type === "help") {
        setHelpOpen(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen, router]);

  return <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />;
}
