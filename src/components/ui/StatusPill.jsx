import { cn } from '../../lib/utils'

const MAP = {
  active: { en: 'Active', ar: 'نشط' },
  planning: { en: 'Planning', ar: 'تخطيط' },
  on_hold: { en: 'On Hold', ar: 'متوقف' },
  completed: { en: 'Completed', ar: 'مكتمل' },
  closed: { en: 'Closed', ar: 'مغلق' },
  draft: { en: 'Draft', ar: 'مسودة' },
  filed: { en: 'Filed', ar: 'مقدم' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  expired: { en: 'Expired', ar: 'منتهي' },
  critical: { en: 'Critical', ar: 'حرج' },
  warning: { en: 'Warning', ar: 'تنبيه' },
  ok: { en: 'OK', ar: 'سليم' },
  'no-expiry': { en: 'No Expiry', ar: 'بدون انتهاء' },
}

export default function StatusPill({ status, percent = null, lang = 'en', label = null, note = null }) {
  const key = String(status || '').toLowerCase()
  const isGood = key === 'active' || key === 'completed' || key === 'filed' || key === 'paid' || key === 'ok'
  const isWarn = key === 'planning' || key === 'on_hold' || key === 'draft' || key === 'warning' || key === 'critical' || key === 'no-expiry'
  const isBad = key === 'expired'
  const displayLabel = label || (MAP[key] ? (lang === 'ar' ? MAP[key].ar : MAP[key].en) : status) || '-'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
        isGood && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isWarn && 'border-amber-200 bg-amber-50 text-amber-700',
        isBad && 'border-rose-200 bg-rose-50 text-rose-700',
        !isGood && !isWarn && !isBad && 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      <span>{displayLabel}</span>
      {percent != null ? <span className="ds-money opacity-70">{Math.round(percent)}%</span> : null}
      {note ? <span className="ds-money opacity-70">{note}</span> : null}
    </span>
  )
}
