import { Link } from 'react-router-dom'
import {
  formatDateValue,
  getExpiryStatusMeta,
  humanizeDaysToExpiry,
} from '../lib/employees'

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
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>

      <div className="summary-strip" style={{ marginBottom: 14 }}>
        <div className="summary-chip expired">
          <span className="label">{lang === 'ar' ? 'منتهية' : 'Expired'}</span>
          <span className="value">{counts.expired}</span>
        </div>
        <div className="summary-chip critical">
          <span className="label">{lang === 'ar' ? 'حرجة 0-30' : 'Critical 0-30'}</span>
          <span className="value">{counts.critical}</span>
        </div>
        <div className="summary-chip warning">
          <span className="label">{lang === 'ar' ? 'تنبيه 31-90' : 'Warning 31-90'}</span>
          <span className="value">{counts.warning}</span>
        </div>
      </div>

      {items?.length ? (
        <div className="monitor-list">
          {items.map((item) => {
            const status = item.statusMeta || getExpiryStatusMeta(item.daysToExpiry, lang)
            return (
              <div key={item.id} className="monitor-item">
                <div className="monitor-item-main">
                  <div className="monitor-item-title">
                    {item.employee_id ? (
                      <Link className="employee-link" to={`/employees/${item.employee_id}`}>
                        {item.employeeName}
                      </Link>
                    ) : item.employeeName}
                  </div>
                  <div className="monitor-item-meta">
                    {item.docTypeLabel} • {formatDateValue(item.expiry_date, lang)}
                    {item.projectName && item.projectName !== '-' ? ` • ${item.projectName}` : ''}
                  </div>
                </div>
                <div className="monitor-item-side">
                  <span className={`status-pill ${status.key}`}>{status.label}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{humanizeDaysToExpiry(item.daysToExpiry, lang)}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card-sub">{emptyLabel}</div>
      )}

      {compact ? (
        <div className="card-sub" style={{ marginTop: 12 }}>
          {lang === 'ar' ? 'القائمة تعرض أقرب المستندات انتهاءً أولًا.' : 'Sorted with the soonest expiries first.'}
        </div>
      ) : null}
    </div>
  )
}