"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "downloads", label: "Most downloads" },
  { value: "stars", label: "Most stars" },
  { value: "name", label: "Name (A–Z)" },
];

export function SortSelect({ defaultValue = "updated" }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "updated") {
      params.set("sort", value);
    } else {
      params.delete("sort");
    }
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="oa-sort" className="text-fg-muted">
        Sort by
      </label>
      <select
        id="oa-sort"
        defaultValue={defaultValue}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-fg focus:border-accent-border focus:outline-none"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
