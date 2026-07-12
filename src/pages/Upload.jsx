import { useState } from 'react'
import { useLang } from '../context/LangContext'

export default function Upload() {
  const { t, lang } = useLang()
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState({ desc: '', amount: '', type: 'receivable' })
  const [files, setFiles] = useState([])

  const handleFile = (e) => {
    const list = Array.from(e.target.files).map((f) => ({ name: f.name, size: f.size, date: new Date().toISOString() }))
    setFiles((prev) => [...list, ...prev])
  }

  const submit = (e) => {
    e.preventDefault()
    if (!form.desc || !form.amount) return
    setEntries((prev) => [{ ...form, amount: Number(form.amount), date: new Date().toISOString() }, ...prev])
    setForm({ desc: '', amount: '', type: 'receivable' })
  }

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

      <h2 className="section-title">{t('add_entry')}</h2>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div>
            <div className="card-label">{t('entry_desc')}</div>
            <input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} required />
          </div>
          <div>
            <div className="card-label">{t('entry_amount')}</div>
            <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div>
            <div className="card-label">{t('entry_type')}</div>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="receivable">{t('receivable')}</option>
              <option value="payable">{t('payable')}</option>
            </select>
          </div>
        </div>
        <button className="btn" type="submit">{t('save')}</button>
      </form>

      {entries.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr><th>{t('entry_desc')}</th><th>{t('entry_type')}</th><th>{t('entry_amount')}</th></tr>
            </thead>
            <tbody>
              {entries.map((en, i) => (
                <tr key={i}>
                  <td>{en.desc}</td>
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
