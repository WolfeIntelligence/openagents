export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="6" r="3.4" fill="var(--color-accent)" />
      <circle cx="6" cy="24" r="3.4" fill="var(--color-fg-muted)" />
      <circle cx="26" cy="24" r="3.4" fill="var(--color-fg-muted)" />
      <path
        d="M16 9.4 L6 20.6 M16 9.4 L26 20.6 M9.2 24 H22.8"
        stroke="var(--color-border-strong)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
