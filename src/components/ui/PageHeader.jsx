import { Button } from './Button'
import { cn } from '../../lib/utils'

export default function PageHeader({ title, subtitle, dateText, actionLabel, onAction, className }) {
  return (
    <div className={cn('ds-card mb-5 flex flex-wrap items-start justify-between gap-4 p-5', className)}>
      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ds-muted)]">{dateText}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-[var(--ds-text)] sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-[var(--ds-muted)]">{subtitle}</p> : null}
      </div>
      {actionLabel ? <Button onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  )
}
