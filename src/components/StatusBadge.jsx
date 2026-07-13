import { useLang } from '../context/LangContext'

export default function StatusBadge({ status }) {
  const { t } = useLang()
  const map = {
    'on-track': { cls: 'on-track', label: t('status_on_track') },
    'watch': { cls: 'at-risk', label: t('status_at_risk') },
    'at-risk': { cls: 'at-risk', label: t('status_at_risk') },
    'critical': { cls: 'delayed', label: t('status_delayed') },
    'delayed': { cls: 'delayed', label: t('status_delayed') },
  }
  const s = map[status] ?? map['on-track']
  return (
    <span className={`badge ${s.cls}`}>
      <span className="badge-dot" />
      {s.label}
    </span>
  )
}
