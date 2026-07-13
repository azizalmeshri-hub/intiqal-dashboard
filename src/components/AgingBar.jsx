import { useLang } from '../context/LangContext'

const buckets = [
  { key: 'current', color: '#4f9d6e', label_ar: '0-30', label_en: '0-30' },
  { key: 'd30', color: '#e8a33d', label_ar: '31-60', label_en: '31-60' },
  { key: 'd60', color: '#e07b39', label_ar: '61-90', label_en: '61-90' },
  { key: 'd90', color: '#d6584a', label_ar: '91-120', label_en: '91-120' },
  { key: 'd90plus', color: '#a83232', label_ar: '+120', label_en: '120+' },
]

export default function AgingBar({ aging, total }) {
  const { lang } = useLang()
  const sum = total ?? Object.values(aging).reduce((a, v) => a + (v || 0), 0)
  if (!sum) return null

  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
        {buckets.map((b) => {
          const val = aging[b.key] || 0
          const pct = (val / sum) * 100
          if (pct <= 0) return null
          return <div key={b.key} style={{ width: `${pct}%`, background: b.color }} title={`${b.label_en}: ${val.toLocaleString('en-US')}`} />
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        {buckets.map((b) => (
          (aging[b.key] || 0) > 0 && (
            <span key={b.key} style={{ fontSize: 11, color: 'var(--steel-400)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, display: 'inline-block' }} />
              {lang === 'ar' ? b.label_ar : b.label_en}: <span className="mono">{(aging[b.key] || 0).toLocaleString('en-US')}</span>
            </span>
          )
        ))}
      </div>
    </div>
  )
}
