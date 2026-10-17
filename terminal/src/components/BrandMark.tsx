export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0a0d16" />
      <path
        d="M8 23.5V10.5L16 18.2 24 10.5V23.5"
        fill="none"
        stroke="#f4f4f5"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="24" cy="10.5" r="2.15" fill="#97fce4" />
    </svg>
  );
}
