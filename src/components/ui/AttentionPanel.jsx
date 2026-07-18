import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from './Card'

export default function AttentionPanel({ title, subtitle, items, emptyText }) {
  return (
    <Card className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle ? <CardSubtitle>{subtitle}</CardSubtitle> : null}
        </div>
        <span className="rounded-full bg-amber-100 p-2 text-amber-600"><AlertTriangle size={16} /></span>
      </div>

      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <Link key={item.id} to={item.href} className="block rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-soft)] px-3 py-2 text-sm text-[var(--ds-text)] no-underline transition hover:border-[var(--ds-accent)]">
            <div className="font-semibold">{item.title}</div>
            {item.description ? <div className="mt-1 text-xs text-[var(--ds-muted)]">{item.description}</div> : null}
          </Link>
        )) : <p className="text-sm text-[var(--ds-muted)]">{emptyText}</p>}
      </div>
    </Card>
  )
}
