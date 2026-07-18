import { TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from './Card'

function trendIcon(trend) {
  if (trend === 'up') return <TrendingUp size={15} />
  if (trend === 'down') return <TrendingDown size={15} />
  return null
}

export default function KpiCard({ label, value, trend, tone = 'default', note }) {
  const toneClass = tone === 'danger'
    ? 'text-[var(--ds-danger)]'
    : tone === 'positive'
      ? 'text-[var(--ds-positive)]'
      : 'text-[var(--ds-text)]'

  return (
    <Card className="min-h-[130px]">
      <div className="text-xs uppercase tracking-[0.08em] text-[var(--ds-muted)]">{label}</div>
      <div className={`ds-money mt-3 text-3xl font-bold ${toneClass}`}>{value}</div>
      {(trend || note) ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ds-muted)]">
          {trendIcon(trend)}
          <span>{note}</span>
        </div>
      ) : null}
    </Card>
  )
}
