interface SearchBoxProps {
  defaultValue?: string;
  size?: "sm" | "lg";
  placeholder?: string;
  className?: string;
}

/** GET form to /explore?q=... Works without JS. */
export function SearchBox({
  defaultValue,
  size = "sm",
  placeholder = "Search packages…",
  className = "",
}: SearchBoxProps) {
  const isLg = size === "lg";
  return (
    <form
      action="/explore"
      method="get"
      role="search"
      className={`flex w-full items-center gap-2 ${className}`}
    >
      <label htmlFor="oa-search-q" className="sr-only">
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
          id="oa-search-q"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-border bg-surface text-fg placeholder:text-fg-subtle focus:border-accent-border focus:outline-none ${
            isLg ? "py-3.5 pl-11 pr-4 text-base" : "py-2 pl-9 pr-3 text-sm"
          }`}
        />
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
