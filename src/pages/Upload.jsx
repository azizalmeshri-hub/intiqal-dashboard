import { useState } from 'react'
import { useLang } from '../context/LangContext'
import { parseUploadedFile } from '../utils/uploadParser'

export default function Upload() {
  const { t, lang } = useLang()
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState({ desc: '', amount: '', type: 'receivable' })
  const [files, setFiles] = useState([])
  const [parsedSuggestions, setParsedSuggestions] = useState([])
  const [isParsing, setIsParsing] = useState(false)

  const handleFile = async (e) => {
    const selectedFiles = Array.from(e.target.files || [])
    const list = selectedFiles.map((f) => ({ name: f.name, size: f.size, date: new Date().toISOString() }))
    setFiles((prev) => [...list, ...prev])

    if (!selectedFiles.length) return

    setIsParsing(true)
    try {
      const allSuggestions = []
      for (const file of selectedFiles) {
        const parsed = await parseUploadedFile(file)
        allSuggestions.push(...parsed)
      }
      setParsedSuggestions((prev) => [...allSuggestions, ...prev])
    } catch (error) {
      console.error('Smart upload parsing failed', error)
    } finally {
      setIsParsing(false)
      e.target.value = ''
    }
  }

  const submit = (e) => {
    e.preventDefault()
    if (!form.desc || !form.amount) return
    setEntries((prev) => [{ ...form, amount: Number(form.amount), date: new Date().toISOString() }, ...prev])
    setForm({ desc: '', amount: '', type: 'receivable' })
  }

  const updateSuggestion = (index, field, value) => {
    setParsedSuggestions((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  const acceptSuggestion = (index) => {
    const suggestion = parsedSuggestions[index]
    if (!suggestion) return
    if (!suggestion.desc || !Number(suggestion.amount)) return

    setEntries((prev) => [
      {
        desc: suggestion.desc,
        amount: Number(suggestion.amount),
        type: suggestion.type,
        project: suggestion.project,
        source: suggestion.source,
        confidence: suggestion.confidence,
        date: new Date().toISOString(),
      },
      ...prev,
    ])
    setParsedSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }

  const rejectSuggestion = (index) => {
    setParsedSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }

  const confidenceBadgeClass = (confidence) => {
    if (confidence >= 0.85) return 'on-track'
    if (confidence >= 0.65) return 'at-risk'
    return 'delayed'
  }

  const projectLabel = (project) => {
    if (project === 'ajdan') return lang === 'ar' ? 'أجدان' : 'Ajdan'
    return lang === 'ar' ? 'سدرة' : 'Sadra'
  }

  return (
    <div>
      <h1 className="display">{t('upload_title')}</h1>
      <p style={{ color: 'var(--steel-400)', maxWidth: 640 }}>{t('upload_desc')}</p>

      <div className="card">
        <label className="upload-zone" style={{ display: 'block', cursor: 'pointer' }}>
          <input type="file" multiple style={{ display: 'none' }} onChange={handleFile} accept=".pdf,.jpg,.jpeg,.png,.csv,.txt,.xlsx,.xls" />
          📎 {t('upload_cta')}
        </label>
        <p className="tag-note" style={{ marginTop: 10 }}>{t('upload_note')}</p>
        {isParsing && (
          <p className="card-sub" style={{ marginTop: 10 }}>
            {lang === 'ar' ? 'جاري تحليل الملفات...' : 'Parsing files...'}
          </p>
        )}
      </div>

      {parsedSuggestions.length > 0 && (
        <>
          <h2 className="section-title">{lang === 'ar' ? 'اقتراحات الرفع الذكي' : 'Smart Upload Suggestions'}</h2>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-label">{lang === 'ar' ? 'مستوى الثقة' : 'Confidence Legend'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="badge on-track">{lang === 'ar' ? 'عالٍ (85%+)' : 'High (85%+)'}</span>
              <span className="badge at-risk">{lang === 'ar' ? 'متوسط (65%-84%)' : 'Medium (65%-84%)'}</span>
              <span className="badge delayed">{lang === 'ar' ? 'منخفض (<65%)' : 'Low (<65%)'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{lang === 'ar' ? 'الوصف' : 'Description'}</th>
                    <th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
                    <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                    <th>{lang === 'ar' ? 'النوع' : 'Type'}</th>
                    <th>{lang === 'ar' ? 'الثقة' : 'Confidence'}</th>
                    <th>{lang === 'ar' ? 'الملف' : 'File'}</th>
                    <th>{lang === 'ar' ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedSuggestions.map((suggestion, index) => (
                    <tr key={`${suggestion.fileName}-${index}`}>
                      <td>
                        <input
                          value={suggestion.desc}
                          onChange={(e) => updateSuggestion(index, 'desc', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={suggestion.amount}
                          onChange={(e) => updateSuggestion(index, 'amount', Number(e.target.value || 0))}
                        />
                      </td>
                      <td>
                        <select
                          value={suggestion.project}
                          onChange={(e) => updateSuggestion(index, 'project', e.target.value)}
                        >
                          <option value="sadra">{lang === 'ar' ? 'سدرة' : 'Sadra'}</option>
                          <option value="ajdan">{lang === 'ar' ? 'أجدان' : 'Ajdan'}</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={suggestion.type}
                          onChange={(e) => updateSuggestion(index, 'type', e.target.value)}
                        >
                          <option value="receivable">{t('receivable')}</option>
                          <option value="payable">{t('payable')}</option>
                        </select>
                      </td>
                      <td>
                        <span className={`badge ${confidenceBadgeClass(suggestion.confidence)}`}>
                          {Math.round((suggestion.confidence || 0) * 100)}%
                        </span>
                      </td>
                      <td>
                        <span className="card-sub">{suggestion.fileName}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn secondary" type="button" onClick={() => acceptSuggestion(index)}>
                            {lang === 'ar' ? 'قبول' : 'Accept'}
                          </button>
                          <button className="btn secondary" type="button" onClick={() => rejectSuggestion(index)}>
                            {lang === 'ar' ? 'رفض' : 'Reject'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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
              <tr>
                <th>{t('entry_desc')}</th>
                <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                <th>{t('entry_type')}</th>
                <th>{lang === 'ar' ? 'المصدر' : 'Source'}</th>
                <th>{lang === 'ar' ? 'الثقة' : 'Confidence'}</th>
                <th>{t('entry_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((en, i) => (
                <tr key={i}>
                  <td>{en.desc}</td>
                  <td>{projectLabel(en.project)}</td>
                  <td>{en.type === 'receivable' ? t('receivable') : t('payable')}</td>
                  <td>{en.source || (lang === 'ar' ? 'يدوي' : 'Manual')}</td>
                  <td>
                    {en.confidence ? (
                      <span className={`badge ${confidenceBadgeClass(en.confidence)}`}>
                        {Math.round(en.confidence * 100)}%
                      </span>
                    ) : (
                      <span className="card-sub">-</span>
                    )}
                  </td>
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
