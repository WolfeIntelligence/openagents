"use client";

import { KindBadge } from "@/components/KindBadge";
import type { SuggestItem } from "@/lib/search-client";

/** DOM id for option `index` within the listbox `listboxId` (`index ===
 *  itemCount` is the trailing "See all results" row). Shared with SearchBox
 *  so its `aria-activedescendant` always points at an id this component
 *  actually renders. */
export function getSuggestionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function pricingLabel(model: SuggestItem["pricing"]["model"]): string {
  if (model === "free") return "Free";
  if (model === "subscription") return "Subscription";
  return "Paid";
}

interface SearchSuggestionsProps {
  listboxId: string;
  labelId?: string;
  query: string;
  items: SuggestItem[];
  total: number;
  /** Index into `items`; `items.length` denotes the "See all" row; `-1` means nothing highlighted. */
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelectItem: (item: SuggestItem) => void;
  onSelectSeeAll: () => void;
}

/** The dropdown listbox rendered under `SearchBox`'s input. Purely
 *  presentational — all state (open/closed, active index, the fetched
 *  items) is owned by `SearchBox`. */
export function SearchSuggestions({
  listboxId,
  labelId,
  query,
  items,
  total,
  activeIndex,
  onHoverIndex,
  onSelectItem,
  onSelectSeeAll,
}: SearchSuggestionsProps) {
  const seeAllIndex = items.length;

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={labelId ? undefined : "Search suggestions"}
      aria-labelledby={labelId}
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <li
            key={item.id}
            id={getSuggestionOptionId(listboxId, index)}
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHoverIndex(index)}
            onMouseDown={(e) => {
              // Prevent the input from blurring before onSelectItem runs.
              e.preventDefault();
            }}
            onClick={() => onSelectItem(item)}
            className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
              active ? "bg-surface-hover" : ""
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <KindBadge kind={item.kind} />
              <span className="truncate text-fg">{item.title}</span>
              <span className="shrink-0 truncate font-mono text-xs text-fg-subtle">
                {item.owner}/{item.name}
              </span>
            </span>
            <span className="shrink-0 text-xs font-medium text-fg-subtle">
              {pricingLabel(item.pricing.model)}
            </span>
          </li>
        );
      })}

      <li
        id={getSuggestionOptionId(listboxId, seeAllIndex)}
        role="option"
        aria-selected={activeIndex === seeAllIndex}
        onMouseEnter={() => onHoverIndex(seeAllIndex)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelectSeeAll}
        className={`cursor-pointer border-t border-border px-3 py-2 text-sm font-medium text-accent ${
          activeIndex === seeAllIndex ? "bg-surface-hover" : ""
        }`}
      >
        See all {total.toLocaleString()} results for &ldquo;{query}&rdquo;
      </li>
    </ul>
  );
}
