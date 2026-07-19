import { Link } from 'react-router-dom'
import {
  formatDateValue,
  getExpiryStatusMeta,
  humanizeDaysToExpiry,
} from '../lib/employees'
import { Card, CardSubtitle, CardTitle } from './ui/Card'
import StatusPill from './ui/StatusPill'

export default function ExpiryMonitorPanel({
  lang,
  title,
  summary,
  items,
  emptyLabel,
  compact = false,
}) {
  const counts = summary || { expired: 0, critical: 0, warning: 0 }

  return (
    <Card className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardSubtitle>
            {lang === 'ar' ? 'مرتبة حسب الأقرب انتهاءً (الأقرب أولاً).' : 'Sorted by soonest expiry first.'}
          </CardSubtitle>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusPill status="expired" lang={lang} note={String(counts.expired)} />
        <StatusPill status="critical" lang={lang} label={lang === 'ar' ? 'حرج 0-30' : 'Critical 0-30'} note={String(counts.critical)} />
        <StatusPill status="warning" lang={lang} label={lang === 'ar' ? 'تنبيه 31-90' : 'Warning 31-90'} note={String(counts.warning)} />
      </div>

      {items?.length ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const status = item.statusMeta || getExpiryStatusMeta(item.daysToExpiry, lang)
            return (
              <div key={item.id} className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-soft)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--ds-text)]">
                    {item.employee_id ? (
                      <Link className="ds-link" to={`/employees/${item.employee_id}`}>
                        {item.employeeName}
                      </Link>
                    ) : item.employeeName}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ds-muted)]">
                      {item.docTypeLabel} - {formatDateValue(item.expiry_date, lang)}
                      {item.projectName && item.projectName !== '-' ? ` - ${item.projectName}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill status={status.key} lang={lang} />
                    <span className="ds-money text-xs text-[var(--ds-muted)]">{humanizeDaysToExpiry(item.daysToExpiry, lang)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-4 text-sm text-[var(--ds-muted)]">{emptyLabel}</div>
      )}

      {compact ? (
        <div className="mt-3 text-sm text-[var(--ds-muted)]">
          {lang === 'ar' ? 'القائمة تعرض أقرب المستندات انتهاءً أولًا.' : 'Sorted with the soonest expiries first.'}
        </div>
      ) : null}
    </Card>
  )
}