import { useEffect, useMemo, useState } from 'react'
import { documentTypeOptions } from '../lib/employees'

export default function EmployeeDocumentModal({
  open,
  lang,
  title,
  submitLabel,
  initialValues,
  requireFile = true,
  onExtractDates,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState({
    doc_type: 'iqama',
    doc_number: '',
    issue_date: '',
    expiry_date: '',
    notes: '',
    file: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (!open) return
    setValues({
      doc_type: initialValues?.doc_type || 'iqama',
      doc_number: initialValues?.doc_number || '',
      issue_date: initialValues?.issue_date || '',
      expiry_date: initialValues?.expiry_date || '',
      notes: initialValues?.notes || '',
      file: null,
    })
    setSubmitting(false)
    setExtracting(false)
    setError('')
    setInfo('')
  }, [open, initialValues])

  const docTypes = useMemo(() => documentTypeOptions(lang), [lang])

  if (!open) return null

  const update = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(values)
      onClose()
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ المستند' : 'Failed to save document'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleExtractDates = async () => {
    if (!values.file) {
      setError(lang === 'ar' ? 'اختر ملفًا أولًا لاستخراج التواريخ.' : 'Choose a file first to extract dates.')
      return
    }
    if (typeof onExtractDates !== 'function') {
      setInfo(lang === 'ar' ? 'ميزة الاستخراج غير مفعلة حاليًا.' : 'Extraction hook is not configured yet.')
      return
    }

    setExtracting(true)
    setError('')
    setInfo('')
    try {
      const result = await onExtractDates({ file: values.file, docType: values.doc_type })
      if (result?.issue_date || result?.expiry_date) {
        setValues((prev) => ({
          ...prev,
          issue_date: result.issue_date || prev.issue_date,
          expiry_date: result.expiry_date || prev.expiry_date,
        }))
        setInfo(lang === 'ar' ? 'تم تعبئة التواريخ المقروءة. راجعها قبل الحفظ.' : 'Extracted dates were filled. Please review before saving.')
      } else {
        setInfo(lang === 'ar' ? 'لم يتم العثور على تواريخ واضحة. أدخلها يدويًا.' : 'No clear dates were found. Please enter them manually.')
      }
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر استخراج التواريخ.' : 'Failed to extract dates.'))
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
        <form onSubmit={handleSubmit} className="side-stack">
          <div>
            <div className="card-label">{lang === 'ar' ? 'نوع المستند' : 'Document Type'}</div>
            <select value={values.doc_type} onChange={(event) => update('doc_type', event.target.value)}>
              {docTypes.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          <div>
            <div className="card-label">{lang === 'ar' ? 'رقم المستند' : 'Document Number'}</div>
            <input value={values.doc_number} onChange={(event) => update('doc_number', event.target.value)} />
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">{lang === 'ar' ? 'تاريخ الإصدار' : 'Issue Date'}</div>
              <input type="date" value={values.issue_date} onChange={(event) => update('issue_date', event.target.value)} />
            </div>
            <div>
              <div className="card-label">{lang === 'ar' ? 'تاريخ الانتهاء' : 'Expiry Date'}</div>
              <input type="date" value={values.expiry_date} onChange={(event) => update('expiry_date', event.target.value)} />
            </div>
          </div>

          <div>
            <div className="card-label">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</div>
            <textarea value={values.notes} onChange={(event) => update('notes', event.target.value)} />
          </div>

          <div>
            <div className="card-label">{lang === 'ar' ? 'الملف' : 'File'}</div>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => update('file', event.target.files?.[0] || null)}
            />
            <div className="employee-actions" style={{ marginTop: 8 }}>
              <button className="btn secondary" type="button" onClick={handleExtractDates} disabled={extracting || !values.file}>
                {extracting
                  ? (lang === 'ar' ? 'جارٍ الاستخراج...' : 'Extracting...')
                  : (lang === 'ar' ? 'استخراج التواريخ (OCR)' : 'Extract Dates (OCR)')}
              </button>
            </div>
            <div className="vault-file-note">
              {requireFile
                ? (lang === 'ar' ? 'مطلوب: PDF أو JPG أو PNG، حتى 10MB.' : 'Required: PDF, JPG, or PNG, up to 10MB.')
                : (lang === 'ar' ? 'اختياري: اتركه فارغًا للإبقاء على الملف الحالي.' : 'Optional: leave empty to keep the current file.')}
            </div>
          </div>

          {info ? (
            <div className="tag-note">{info}</div>
          ) : null}

          {error ? (
            <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
          ) : null}

          <div className="employee-actions" style={{ justifyContent: 'flex-end' }}>
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