export default function ProgressBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-[var(--ds-accent)] transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
