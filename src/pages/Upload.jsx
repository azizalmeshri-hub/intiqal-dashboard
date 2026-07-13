import { useMemo, useState } from 'react'
import { useLang } from '../context/LangContext'
import { projects } from '../data/projects'

export default function Upload() {
  const { t, lang } = useLang()
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState({ desc: '', amount: '', type: 'receivable', project: 'sadra' })
  const [files, setFiles] = useState([])

  const handleFile = (e) => {
    const list = Array.from(e.target.files).map((f) => ({ name: f.name, size: f.size, date: new Date().toISOString() }))
    setFiles((prev) => [...list, ...prev])
  }

  const submit = (e) => {
    e.preventDefault()
    if (!form.desc || !form.amount) return
    setEntries((prev) => [{ ...form, amount: Number(form.amount), date: new Date().toISOString() }, ...prev])
    setForm({ desc: '', amount: '', type: 'receivable', project: 'sadra' })
  }

  const suggestedBreakdown = useMemo(() => {
    const base = Number(form.amount || 0)
    if (!base) return []
    return [
      { label: lang === 'ar' ? 'مواد / توريد' : 'Materials / Supplies', value: base * 0.55 },
      { label: lang === 'ar' ? 'عمالة' : 'Labour', value: base * 0.3 },
      { label: lang === 'ar' ? 'مصاريف عامة' : 'Overheads', value: base * 0.15 },
    ]
  }, [form.amount, lang])

  return (
    <div>
      <h1 className="display">{t('upload_title')}</h1>
      <p style={{ color: 'var(--steel-400)', maxWidth: 640 }}>{t('upload_desc')}</p>

      <div className="card">
        <label className="upload-zone" style={{ display: 'block', cursor: 'pointer' }}>
          <input type="file" multiple style={{ display: 'none' }} onChange={handleFile} accept=".pdf,.jpg,.jpeg,.png" />
          📎 {t('upload_cta')}
        </label>
        <p className="tag-note" style={{ marginTop: 10 }}>{t('upload_note')}</p>
      </div>

      <h2 className="section-title">{t('smart_upload')}</h2>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div>
            <div className="card-label">{t('project_selection')}</div>
            <select value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })}>
              <option value="sadra">{lang === 'ar' ? projects.sadra.name_ar : projects.sadra.name_en}</option>
              <option value="ajdan">{lang === 'ar' ? projects.ajdan.name_ar : projects.ajdan.name_en}</option>
            </select>
          </div>
          <div>
            <div className="card-label">{t('document_type')}</div>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="receivable">{t('receivable')}</option>
              <option value="payable">{t('payable')}</option>
            </select>
          </div>
          <div>
            <div className="card-label">{t('entry_desc')}</div>
            <input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} required />
          </div>
          <div>
            <div className="card-label">{t('entry_amount')}</div>
            <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
        </div>
        <div className="card" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="card-label">{t('estimate_breakdown')}</div>
          <div className="grid grid-3">
            {suggestedBreakdown.map((row) => (
              <div key={row.label} className="card">
                <div className="card-label">{row.label}</div>
                <div className="card-value">{row.value.toLocaleString('en-US')} SAR</div>
              </div>
            ))}
          </div>
        </div>
        <button className="btn" type="submit" style={{ marginTop: 12 }}>{t('save')}</button>
      </form>

      {files.length > 0 && (
        <>
          <h2 className="section-title">{t('recent_uploads')}</h2>
          <div className="card">
            <table className="table">
              <thead><tr><th>{lang === 'ar' ? 'الملف' : 'File'}</th><th>{lang === 'ar' ? 'الحجم' : 'Size'}</th></tr></thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}><td>{f.name}</td><td className="num">{(f.size / 1024).toFixed(1)} KB</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {entries.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-label">{t('upload_summary')}</div>
          <table className="table">
            <thead>
              <tr><th>{t('entry_desc')}</th><th>{t('project_selection')}</th><th>{t('entry_type')}</th><th>{t('entry_amount')}</th></tr>
            </thead>
            <tbody>
              {entries.map((en, i) => (
                <tr key={i}>
                  <td>{en.desc}</td>
                  <td>{lang === 'ar' ? (en.project === 'sadra' ? projects.sadra.name_ar : projects.ajdan.name_ar) : (en.project === 'sadra' ? projects.sadra.name_en : projects.ajdan.name_en)}</td>
                  <td>{en.type === 'receivable' ? t('receivable') : t('payable')}</td>
                  <td className={`num ${en.type === 'receivable' ? 'pos' : 'neg'}`}>{en.amount.toLocaleString('en-US')} SAR</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
