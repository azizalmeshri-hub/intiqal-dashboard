import { useEffect, useMemo, useState } from 'react'

function initialFromColumns(columns, initialValues) {
  const base = {}
  columns.forEach((col) => {
    if (col.defaultValue !== undefined) base[col.key] = col.defaultValue
    else base[col.key] = ''
  })
  return { ...base, ...(initialValues || {}) }
}

export default function RecordFormModal({
  open,
  title,
  columns,
  initialValues,
  submitLabel,
  onClose,
  onSubmit,
  lang,
}) {
  const [values, setValues] = useState(() => initialFromColumns(columns, initialValues))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setValues(initialFromColumns(columns, initialValues))
      setError('')
      setSubmitting(false)
    }
  }, [open, columns, initialValues])

  const visibleColumns = useMemo(() => columns.filter((c) => c.addable !== false), [columns])

  if (!open) return null

  const update = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(values)
      onClose()
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر الحفظ' : 'Failed to save'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
        <form onSubmit={handleSubmit} className="side-stack">
          {visibleColumns.map((col) => (
            <div key={col.key}>
              <div className="card-label">{lang === 'ar' ? (col.labelAr || col.label) : col.label}</div>
              {col.type === 'select' ? (
                <select
                  value={values[col.key] ?? ''}
                  onChange={(e) => update(col.key, e.target.value)}
                >
                  <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                  {(col.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                  step={col.type === 'number' ? '0.01' : undefined}
                  value={values[col.key] ?? ''}
                  onChange={(e) => update(col.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {error && (
            <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn secondary" type="button" onClick={onClose}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
