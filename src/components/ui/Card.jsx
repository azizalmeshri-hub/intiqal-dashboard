import { cn } from '../../lib/utils'

export function Card({ className, children, ...props }) {
  return (
    <section className={cn('ds-card p-5', className)} {...props}>
      {children}
    </section>
  )
}

export function CardTitle({ className, children }) {
  return <h3 className={cn('text-base font-bold text-[var(--ds-text)]', className)}>{children}</h3>
}

export function CardSubtitle({ className, children }) {
  return <p className={cn('mt-1 text-sm text-[var(--ds-muted)]', className)}>{children}</p>
}
