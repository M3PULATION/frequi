export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return <img src="/logo.png" alt="" className={`object-contain ${className}`} />;
}
