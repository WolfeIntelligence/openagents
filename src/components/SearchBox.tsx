"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { SearchSuggestions, getSuggestionOptionId } from "@/components/SearchSuggestions";
import { createSuggestionFetcher, type SuggestItem } from "@/lib/search-client";

interface SearchBoxProps {
  defaultValue?: string;
  size?: "sm" | "lg";
  placeholder?: string;
  className?: string;
}

/**
 * GET form to /explore?q=... — this keeps working with JavaScript disabled
 * or erroring: the `<form action="/explore" method="get">` below is a real,
 * submittable form regardless of anything React does on top of it. With JS,
 * it's progressively enhanced into an ARIA combobox (WAI-ARIA Combobox
 * pattern) that shows up to 6 live suggestions as you type.
 */
export function SearchBox({
  defaultValue = "",
  size = "sm",
  placeholder = "Search packages…",
  className = "",
}: SearchBoxProps) {
  const isLg = size === "lg";
  const router = useRouter();
  const reactId = useId();
  const inputId = `oa-search-q-${reactId}`;
  const listboxId = `oa-search-listbox-${reactId}`;

  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Lazy initializer keeps this a single stable instance for the component's
  // lifetime without touching a ref during render (refs are for imperative
  // effects/handlers only — see the react-hooks/refs rule).
  const [fetcher] = useState(() => createSuggestionFetcher());

  useEffect(() => {
    // Cancel any pending debounce timer / in-flight request on unmount.
    return () => fetcher.cancel();
  }, [fetcher]);

  const seeAllIndex = items.length;

  function handleChange(next: string) {
    setValue(next);
    setActiveIndex(-1);
    fetcher.fetchSuggestions(next, (result) => {
      if (!result || result.items.length === 0) {
        setItems([]);
        setTotal(0);
        setOpen(false);
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setOpen(true);
    });
  }

  function goToPackage(item: SuggestItem) {
    setOpen(false);
    router.push(`/p/${item.owner}/${item.name}`);
  }

  function goToAllResults() {
    setOpen(false);
    const trimmed = value.trim();
    router.push(trimmed ? `/explore?q=${encodeURIComponent(trimmed)}` : "/explore");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, seeAllIndex));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
        if (activeIndex >= 0 && activeIndex < items.length) {
          // A real result is highlighted — open it instead of submitting the form.
          e.preventDefault();
          goToPackage(items[activeIndex]);
        }
        // Otherwise (nothing highlighted, or the "See all" row is highlighted)
        // fall through and let the form submit normally — identical to what
        // happens with no JS at all.
        break;
      case "Escape":
        setOpen(false);
        setActiveIndex(-1);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <form
      action="/explore"
      method="get"
      role="search"
      className={`flex w-full items-center gap-2 ${className}`}
    >
      <label htmlFor={inputId} className="sr-only">
        Search packages
      </label>
      <div className="relative flex-1">
        <svg
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-subtle ${
            isLg ? "left-4 h-5 w-5" : "left-3 h-4 w-4"
          }`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="M17 17 L13.5 13.5" strokeLinecap="round" />
        </svg>
        <input
          id={inputId}
          type="search"
          name="q"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          autoComplete="off"
          data-oa-search-input="true"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? getSuggestionOptionId(listboxId, activeIndex) : undefined
          }
          className={`w-full rounded-lg border border-border bg-surface text-fg placeholder:text-fg-subtle focus:border-accent-border focus:outline-none ${
            isLg ? "py-3.5 pl-11 pr-4 text-base" : "py-2 pl-9 pr-3 text-sm"
          }`}
        />
        {open && items.length > 0 && (
          <SearchSuggestions
            listboxId={listboxId}
            labelId={inputId}
            query={value.trim()}
            items={items}
            total={total}
            activeIndex={activeIndex}
            onHoverIndex={setActiveIndex}
            onSelectItem={goToPackage}
            onSelectSeeAll={goToAllResults}
          />
        )}
      </div>
      <button
        type="submit"
        className={`shrink-0 rounded-lg bg-accent font-medium text-accent-fg transition-colors hover:bg-accent-hover ${
          isLg ? "px-5 py-3.5 text-base" : "px-3 py-2 text-sm"
        }`}
      >
        Search
      </button>
    </form>
  );
}
