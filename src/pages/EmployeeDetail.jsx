import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import EmployeeDocumentModal from '../components/EmployeeDocumentModal'
import { supabase } from '../lib/supabase'
import {
  buildEmployeeDocumentPath,
  contractTypeOptions,
  documentTypeOptions,
  employeeDocValidationMessage,
  friendlyEmployeeError,
  employeeStatusOptions,
  formatDateValue,
  formatEmployeeName,
  formatProjectName,
  friendlyStorageError,
  getDocumentTypeLabel,
  getExpiryStatusMeta,
  humanizeDaysToExpiry,
  normalizeBooleanValue,
  normalizeNumberValue,
  sponsorshipOptions,
  stripEmployeeDocumentBucket,
  getDaysToExpiry,
} from '../lib/employees'

const DEBOUNCE_MS = 800

function mapEmployeeField(field, value) {
  if (['base_salary', 'housing_allow', 'transport_allow', 'other_allow'].includes(field)) return normalizeNumberValue(value)
  if (field === 'is_on_sponsorship') return normalizeBooleanValue(value)
  if (['project_id', 'hire_date', 'contract_type', 'status'].includes(field)) return value || null
  return value === '' ? null : value
}

export default function EmployeeDetail() {
  const { id } = useParams()
  const { lang } = useLang()
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [employee, setEmployee] = useState(null)
  const [documents, setDocuments] = useState([])
  const [projects, setProjects] = useState([])
  const [statusByField, setStatusByField] = useState({})
  const [openAddDoc, setOpenAddDoc] = useState(false)
  const [replaceDoc, setReplaceDoc] = useState(null)

  const pendingRef = useRef({})
  const timersRef = useRef({})

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [employeeRes, docsRes, projectsRes] = await Promise.all([
          supabase.from('employees').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
          supabase.from('employee_documents').select('*').eq('employee_id', id).order('expiry_date', { ascending: true }),
          supabase.from('projects').select('id,name_ar,name_en').order('name_en', { ascending: true }),
        ])
        if (employeeRes.error) throw employeeRes.error
        if (docsRes.error) throw docsRes.error
        if (projectsRes.error) throw projectsRes.error
        if (!active) return
        setEmployee(employeeRes.data || null)
        setDocuments(docsRes.data || [])
        setProjects(projectsRes.data || [])
      } catch (err) {
        if (!active) return
        setError(err?.message || 'Failed to load employee')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [id])

  const projectOptions = useMemo(() => projects.map((row) => ({ value: row.id, label: formatProjectName(row, lang) })), [projects, lang])
  const projectById = useMemo(() => Object.fromEntries(projects.map((row) => [row.id, row])), [projects])

  const flushField = async (field) => {
    const value = pendingRef.current[field]
    if (value === undefined) return
    try {
      if (!isAdmin) throw new Error("You don't have permission to edit")
      const { error: updateError } = await supabase.from('employees').update({ [field]: value }).eq('id', id)
      if (updateError) throw new Error(friendlyEmployeeError(updateError, lang))
      setStatusByField((prev) => ({ ...prev, [field]: 'saved' }))
      window.dispatchEvent(new Event('intiqal:data-changed'))
    } catch (err) {
      setStatusByField((prev) => ({ ...prev, [field]: 'retry' }))
      setError(err?.message || 'Update failed')
    } finally {
      delete pendingRef.current[field]
    }
  }

  const onFieldChange = (field, rawValue) => {
    const value = mapEmployeeField(field, rawValue)
    setEmployee((prev) => ({ ...prev, [field]: value }))
    pendingRef.current[field] = value
    setStatusByField((prev) => ({ ...prev, [field]: 'saving' }))
    if (timersRef.current[field]) clearTimeout(timersRef.current[field])
    timersRef.current[field] = setTimeout(() => flushField(field), DEBOUNCE_MS)
  }

  const statusText = (status) => {
    if (status === 'saving') return lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'
    if (status === 'saved') return lang === 'ar' ? 'تم ✓' : 'Saved ✓'
    if (status === 'retry') return lang === 'ar' ? 'إعادة المحاولة' : 'Retry'
    return ''
  }

  const uploadFile = async (employeeId, docType, file) => {
    const validation = employeeDocValidationMessage(file, lang)
    if (validation) throw new Error(validation)
    const filePath = buildEmployeeDocumentPath(employeeId, docType, file.name)
    const objectPath = stripEmployeeDocumentBucket(filePath)
    const { error: uploadError } = await supabase.storage.from('employee-docs').upload(objectPath, file, { upsert: true })
    if (uploadError) throw new Error(friendlyStorageError(uploadError, lang))
    return filePath
  }

  const addDocument = async (values) => {
    if (!isAdmin) throw new Error("You don't have permission to edit")
    const filePath = await uploadFile(id, values.doc_type, values.file)
    const payload = {
      employee_id: id,
      doc_type: values.doc_type,
      doc_number: values.doc_number || null,
      issue_date: values.issue_date || null,
      expiry_date: values.expiry_date || null,
      file_path: filePath,
      notes: values.notes || null,
    }
    const { data, error: insertError } = await supabase.from('employee_documents').insert(payload).select().single()
    if (insertError) throw insertError
    setDocuments((prev) => [...prev, data].sort((a, b) => String(a.expiry_date || '').localeCompare(String(b.expiry_date || ''))))
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const replaceDocument = async (values) => {
    if (!replaceDoc) return
    if (!isAdmin) throw new Error("You don't have permission to edit")
    let filePath = replaceDoc.file_path
    if (values.file) {
      filePath = await uploadFile(id, values.doc_type, values.file)
      if (replaceDoc.file_path) {
        await supabase.storage.from('employee-docs').remove([stripEmployeeDocumentBucket(replaceDoc.file_path)])
      }
    }
    const payload = {
      doc_type: values.doc_type,
      doc_number: values.doc_number || null,
      issue_date: values.issue_date || null,
      expiry_date: values.expiry_date || null,
      notes: values.notes || null,
      file_path: filePath,
    }
    const { data, error: updateError } = await supabase.from('employee_documents').update(payload).eq('id', replaceDoc.id).select().single()
    if (updateError) throw updateError
    setDocuments((prev) => prev.map((row) => row.id === replaceDoc.id ? data : row))
    setReplaceDoc(null)
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const deleteDocument = async (row) => {
    if (!isAdmin) return
    const { error: deleteError } = await supabase.from('employee_documents').delete().eq('id', row.id)
    if (deleteError) {
      setError(deleteError.message || 'Delete failed')
      return
    }
    if (row.file_path) {
      await supabase.storage.from('employee-docs').remove([stripEmployeeDocumentBucket(row.file_path)])
    }
    setDocuments((prev) => prev.filter((item) => item.id !== row.id))
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const openSignedUrl = async (row, download = false) => {
    const objectPath = stripEmployeeDocumentBucket(row.file_path)
    const { data, error: signedError } = await supabase.storage.from('employee-docs').createSignedUrl(objectPath, 60 * 5)
    if (signedError) {
      setError(friendlyStorageError(signedError, lang))
      return
    }
    if (download) {
      const anchor = document.createElement('a')
      anchor.href = data.signedUrl
      anchor.download = objectPath.split('/').pop() || 'document'
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.click()
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const fields = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'الاسم (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'الاسم (EN)' },
    { key: 'iqama_no', label: 'Iqama No', labelAr: 'رقم الإقامة' },
    { key: 'nationality', label: 'Nationality', labelAr: 'الجنسية' },
    { key: 'job_title', label: 'Job Title', labelAr: 'المسمى الوظيفي' },
    { key: 'project_id', label: 'Project', labelAr: 'المشروع', type: 'select', options: projectOptions },
    { key: 'hire_date', label: 'Hire Date', labelAr: 'تاريخ التعيين', type: 'date' },
    { key: 'contract_type', label: 'Contract Type', labelAr: 'نوع العقد', type: 'select', options: contractTypeOptions(lang) },
    { key: 'status', label: 'Status', labelAr: 'الحالة', type: 'select', options: employeeStatusOptions(lang) },
    { key: 'is_on_sponsorship', label: 'On Sponsorship', labelAr: 'على الكفالة', type: 'select', options: sponsorshipOptions(lang) },
    { key: 'base_salary', label: 'Base Salary', labelAr: 'الراتب الأساسي', type: 'number' },
    { key: 'housing_allow', label: 'Housing Allowance', labelAr: 'بدل السكن', type: 'number' },
    { key: 'transport_allow', label: 'Transport Allowance', labelAr: 'بدل النقل', type: 'number' },
    { key: 'other_allow', label: 'Other Allowance', labelAr: 'بدلات أخرى', type: 'number' },
    { key: 'gosi_no', label: 'GOSI No', labelAr: 'رقم التأمينات' },
    { key: 'notes', label: 'Notes', labelAr: 'ملاحظات', type: 'textarea', full: true },
  ], [lang, projectOptions])

  if (loading) {
    return <div className="card"><div className="card-label">{lang === 'ar' ? 'تحميل ملف الموظف...' : 'Loading employee record...'}</div></div>
  }

  if (error && !employee) {
    return <div className="card"><div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div></div>
  }

  if (!employee) {
    return <div className="card"><div className="card-sub">{lang === 'ar' ? 'الموظف غير موجود.' : 'Employee not found.'}</div></div>
  }

  return (
    <div>
      <h1 className="display">{formatEmployeeName(employee, lang)}</h1>
      {error ? <div className="tag-note" style={{ marginTop: 10, color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div> : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'بيانات الموظف' : 'Employee Details'}</div>
        <div className="employee-detail-grid">
          {fields.map((field) => {
            const label = lang === 'ar' ? (field.labelAr || field.label) : field.label
            const rawValue = employee[field.key]
            const displayValue = field.key === 'project_id'
              ? formatProjectName(projectById[rawValue], lang)
              : field.key === 'is_on_sponsorship'
                ? (rawValue == null ? '-' : (rawValue ? (lang === 'ar' ? 'نعم' : 'Yes') : (lang === 'ar' ? 'لا' : 'No')))
                : rawValue == null || rawValue === '' ? '-' : String(rawValue)
            return (
              <div key={field.key} className={`employee-field ${field.full ? 'full' : ''}`}>
                <div className="card-label">{label}</div>
                {!isAdmin ? (
                  field.type === 'textarea' ? <div className="card-sub">{displayValue}</div> : <div>{displayValue}</div>
                ) : field.type === 'select' ? (
                  <>
                    <select value={field.key === 'is_on_sponsorship' ? String(rawValue ?? '') : (rawValue || '')} onChange={(event) => onFieldChange(field.key, event.target.value)}>
                      <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                      {field.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    {statusByField[field.key] ? <span className="save-pill">{statusText(statusByField[field.key])}</span> : null}
                  </>
                ) : field.type === 'textarea' ? (
                  <>
                    <textarea value={rawValue || ''} onChange={(event) => onFieldChange(field.key, event.target.value)} />
                    {statusByField[field.key] ? <span className="save-pill">{statusText(statusByField[field.key])}</span> : null}
                  </>
                ) : (
                  <>
                    <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={rawValue || ''} onChange={(event) => onFieldChange(field.key, event.target.value)} />
                    {statusByField[field.key] ? <span className="save-pill">{statusText(statusByField[field.key])}</span> : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="section-title" style={{ margin: 0 }}>{lang === 'ar' ? 'خزنة المستندات' : 'Document Vault'}</div>
          {isAdmin ? (
            <button className="btn" type="button" onClick={() => setOpenAddDoc(true)}>
              {lang === 'ar' ? 'إضافة مستند' : 'Add Document'}
            </button>
          ) : null}
        </div>

        {documents.length === 0 ? (
          <div className="card-sub">{lang === 'ar' ? 'لا توجد مستندات لهذا الموظف.' : 'No documents for this employee yet.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'النوع' : 'Type'}</th>
                  <th>{lang === 'ar' ? 'الرقم' : 'Number'}</th>
                  <th>{lang === 'ar' ? 'الإصدار' : 'Issue Date'}</th>
                  <th>{lang === 'ar' ? 'الانتهاء' : 'Expiry Date'}</th>
                  <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th>{lang === 'ar' ? 'الأيام المتبقية' : 'Days Remaining'}</th>
                  <th>{lang === 'ar' ? 'الملف' : 'File'}</th>
                  {isAdmin ? <th>{lang === 'ar' ? 'إجراءات' : 'Actions'}</th> : null}
                </tr>
              </thead>
              <tbody>
                {documents.map((row) => {
                  const days = getDaysToExpiry(row.expiry_date)
                  const status = getExpiryStatusMeta(days, lang)
                  return (
                    <tr key={row.id}>
                      <td>{getDocumentTypeLabel(row.doc_type, lang)}</td>
                      <td>{row.doc_number || '-'}</td>
                      <td>{formatDateValue(row.issue_date, lang)}</td>
                      <td>{formatDateValue(row.expiry_date, lang)}</td>
                      <td><span className={`status-pill ${status.key}`}>{status.label}</span></td>
                      <td>{humanizeDaysToExpiry(days, lang)}</td>
                      <td>
                        {row.file_path ? (
                          <div className="employee-actions">
                            <button className="btn secondary" type="button" onClick={() => openSignedUrl(row, false)}>
                              {lang === 'ar' ? 'عرض' : 'View'}
                            </button>
                            <button className="btn secondary" type="button" onClick={() => openSignedUrl(row, true)}>
                              {lang === 'ar' ? 'تنزيل' : 'Download'}
                            </button>
                          </div>
                        ) : (
                          <span className="card-sub">-</span>
                        )}
                      </td>
                      {isAdmin ? (
                        <td>
                          <div className="employee-actions">
                            <button className="btn secondary" type="button" onClick={() => setReplaceDoc(row)}>
                              {lang === 'ar' ? 'استبدال' : 'Replace'}
                            </button>
                            <button className="btn secondary" type="button" onClick={() => deleteDocument(row)}>
                              {lang === 'ar' ? 'حذف' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmployeeDocumentModal
        open={openAddDoc && isAdmin}
        lang={lang}
        title={lang === 'ar' ? 'إضافة مستند' : 'Add Document'}
        submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
        initialValues={null}
        requireFile
        onClose={() => setOpenAddDoc(false)}
        onSubmit={addDocument}
      />

      <EmployeeDocumentModal
        open={Boolean(replaceDoc) && isAdmin}
        lang={lang}
        title={lang === 'ar' ? 'استبدال مستند' : 'Replace Document'}
        submitLabel={lang === 'ar' ? 'تحديث' : 'Update'}
        initialValues={replaceDoc}
        requireFile={false}
        onClose={() => setReplaceDoc(null)}
        onSubmit={replaceDocument}
      />
    </div>
  )
}