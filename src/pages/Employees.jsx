import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import RecordFormModal from '../components/RecordFormModal'
import ExpiryMonitorPanel from '../components/ExpiryMonitorPanel'
import { supabase } from '../lib/supabase'
import {
  buildEmployeeExpirySummary,
  buildExpiringDocumentsList,
  contractTypeOptions,
  countEmployeeSoonDocs,
  employeeStatusOptions,
  EXPIRY_MONITOR_DOC_TYPES,
  friendlyEmployeeError,
  formatEmployeeName,
  formatProjectName,
  normalizeBooleanValue,
  normalizeNumberValue,
  sponsorshipOptions,
} from '../lib/employees'

const DEBOUNCE_MS = 800

function employeePayload(field, rawValue) {
  if (['base_salary', 'housing_allow', 'transport_allow', 'other_allow'].includes(field)) {
    return normalizeNumberValue(rawValue)
  }
  if (field === 'is_on_sponsorship') {
    return normalizeBooleanValue(rawValue)
  }
  if (field === 'project_id' || field === 'hire_date' || field === 'contract_type' || field === 'status') {
    return rawValue || null
  }
  return rawValue === '' ? null : rawValue
}

export default function Employees() {
  const { lang } = useLang()
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [employees, setEmployees] = useState([])
  const [documents, setDocuments] = useState([])
  const [projects, setProjects] = useState([])
  const [openAdd, setOpenAdd] = useState(false)
  const [statusByCell, setStatusByCell] = useState({})
  const [refreshTick, setRefreshTick] = useState(0)

  const timersRef = useRef({})
  const pendingRef = useRef({})

  useEffect(() => {
    const refresh = () => setRefreshTick((value) => value + 1)
    window.addEventListener('intiqal:data-changed', refresh)
    return () => window.removeEventListener('intiqal:data-changed', refresh)
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [employeesRes, docsRes, projectsRes] = await Promise.all([
          supabase.from('employees').select('*').is('deleted_at', null).order('name_en', { ascending: true }),
          supabase.from('employee_documents').select('*').order('expiry_date', { ascending: true }),
          supabase.from('projects').select('id,name_ar,name_en').order('name_en', { ascending: true }),
        ])

        if (employeesRes.error) throw employeesRes.error
        if (docsRes.error) throw docsRes.error
        if (projectsRes.error) throw projectsRes.error

        if (!active) return
        setEmployees(employeesRes.data || [])
        setDocuments(docsRes.data || [])
        setProjects(projectsRes.data || [])
      } catch (err) {
        if (!active) return
        setError(err?.message || 'Failed to load employees')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [refreshTick])

  const projectById = useMemo(() => Object.fromEntries(projects.map((row) => [row.id, row])), [projects])
  const employeeDocuments = useMemo(() => {
    const map = new Map()
    for (const row of documents) {
      if (!map.has(row.employee_id)) map.set(row.employee_id, [])
      map.get(row.employee_id).push(row)
    }
    return map
  }, [documents])

  const employeesById = useMemo(() => Object.fromEntries(employees.map((row) => [row.id, row])), [employees])
  const expirySummary = useMemo(
    () => buildEmployeeExpirySummary(documents, { docTypes: EXPIRY_MONITOR_DOC_TYPES }),
    [documents],
  )
  const urgentDocuments = useMemo(
    () => buildExpiringDocumentsList(documents, employeesById, projectById, lang, { docTypes: EXPIRY_MONITOR_DOC_TYPES }),
    [documents, employeesById, projectById, lang],
  )

  const projectOptions = useMemo(() => projects.map((row) => ({
    value: row.id,
    label: formatProjectName(row, lang),
  })), [projects, lang])

  const addColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'الاسم (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'الاسم (EN)' },
    { key: 'iqama_no', label: 'Iqama No', labelAr: 'رقم الإقامة' },
    { key: 'nationality', label: 'Nationality', labelAr: 'الجنسية' },
    { key: 'job_title', label: 'Job Title', labelAr: 'المسمى الوظيفي' },
    { key: 'project_id', label: 'Project', labelAr: 'المشروع', type: 'select', options: projectOptions },
    { key: 'hire_date', label: 'Hire Date', labelAr: 'تاريخ التعيين', type: 'date' },
    { key: 'contract_type', label: 'Contract Type', labelAr: 'نوع العقد', type: 'select', options: contractTypeOptions(lang) },
    { key: 'base_salary', label: 'Base Salary', labelAr: 'الراتب الأساسي', type: 'number' },
    { key: 'housing_allow', label: 'Housing Allowance', labelAr: 'بدل السكن', type: 'number' },
    { key: 'transport_allow', label: 'Transport Allowance', labelAr: 'بدل النقل', type: 'number' },
    { key: 'other_allow', label: 'Other Allowance', labelAr: 'بدلات أخرى', type: 'number' },
    { key: 'status', label: 'Status', labelAr: 'الحالة', type: 'select', options: employeeStatusOptions(lang) },
    { key: 'is_on_sponsorship', label: 'On Sponsorship', labelAr: 'على الكفالة', type: 'select', options: sponsorshipOptions(lang) },
    { key: 'gosi_no', label: 'GOSI No', labelAr: 'رقم التأمينات' },
    { key: 'notes', label: 'Notes', labelAr: 'ملاحظات' },
  ], [lang, projectOptions])

  const flushField = async (rowId, field) => {
    const patch = pendingRef.current[rowId]?.[field]
    if (patch === undefined) return

    try {
      if (!isAdmin) throw new Error("You don't have permission to edit")
      const { error: updateError } = await supabase.from('employees').update({ [field]: patch }).eq('id', rowId)
      if (updateError) throw updateError
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'saved' }))
      window.dispatchEvent(new Event('intiqal:data-changed'))
    } catch (err) {
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'retry' }))
      setError(err?.message || 'Update failed')
    } finally {
      if (pendingRef.current[rowId]) delete pendingRef.current[rowId][field]
    }
  }

  const onChangeCell = (rowId, field, rawValue) => {
    const value = employeePayload(field, rawValue)
    setEmployees((prev) => prev.map((row) => row.id === rowId ? { ...row, [field]: value } : row))
    pendingRef.current[rowId] = { ...(pendingRef.current[rowId] || {}), [field]: value }
    const key = `${rowId}:${field}`
    setStatusByCell((prev) => ({ ...prev, [key]: 'saving' }))
    if (timersRef.current[key]) clearTimeout(timersRef.current[key])
    timersRef.current[key] = setTimeout(() => flushField(rowId, field), DEBOUNCE_MS)
  }

  const addEmployee = async (values) => {
    if (!isAdmin) throw new Error("You don't have permission to edit")
    const payload = {}
    for (const column of addColumns) {
      payload[column.key] = employeePayload(column.key, values[column.key])
    }
    payload.deleted_at = null

    const { data, error: insertError } = await supabase.from('employees').insert(payload).select().single()
    if (insertError) throw new Error(friendlyEmployeeError(insertError, lang))
    setEmployees((prev) => [data, ...prev])
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const deleteEmployee = async (row) => {
    if (!isAdmin) return
    const { error: deleteError } = await supabase.from('employees').update({ deleted_at: new Date().toISOString() }).eq('id', row.id)
    if (deleteError) {
      setError(deleteError.message || 'Delete failed')
      return
    }
    setEmployees((prev) => prev.filter((item) => item.id !== row.id))
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const statusText = (status) => {
    if (status === 'saving') return lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'
    if (status === 'saved') return lang === 'ar' ? 'تم ✓' : 'Saved ✓'
    if (status === 'retry') return lang === 'ar' ? 'إعادة المحاولة' : 'Retry'
    return ''
  }

  if (loading) {
    return <div className="card"><div className="card-label">{lang === 'ar' ? 'تحميل الموظفين...' : 'Loading employees...'}</div></div>
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'الموظفون' : 'Employees'}</h1>

      {error ? (
        <div className="tag-note" style={{ marginTop: 10, color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <ExpiryMonitorPanel
          lang={lang}
          title={lang === 'ar' ? 'تنبيهات انتهاء الإقامات وتصاريح العمل' : 'Iqama & Work-Permit Expiry Monitor'}
          summary={expirySummary}
          items={urgentDocuments}
          emptyLabel={lang === 'ar' ? 'لا توجد مستندات منتهية أو على وشك الانتهاء خلال 90 يومًا.' : 'No employee documents are expired or due within 90 days.'}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="section-title" style={{ margin: 0 }}>{lang === 'ar' ? 'سجل الموظفين' : 'Employee Registry'}</div>
          {isAdmin ? (
            <button className="btn" type="button" onClick={() => setOpenAdd(true)}>
              {lang === 'ar' ? 'إضافة موظف' : 'Add Employee'}
            </button>
          ) : null}
        </div>

        {employees.length === 0 ? (
          <div className="card-sub">{lang === 'ar' ? 'لا يوجد موظفون بعد.' : 'No employees yet.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'الاسم' : 'Name'}</th>
                  <th>{lang === 'ar' ? 'رقم الإقامة' : 'Iqama No'}</th>
                  <th>{lang === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}</th>
                  <th>{lang === 'ar' ? 'الجنسية' : 'Nationality'}</th>
                  <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                  <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th>{lang === 'ar' ? 'وثائق قريبة الانتهاء' : 'Docs Expiring Soon'}</th>
                  {isAdmin ? <th>{lang === 'ar' ? 'حذف' : 'Delete'}</th> : null}
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => {
                  const docsCount = countEmployeeSoonDocs(employeeDocuments.get(row.id) || [])
                  const name = formatEmployeeName(row, lang)
                  const projectLabel = formatProjectName(projectById[row.project_id], lang)
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="cell-edit-wrap">
                          <Link className="employee-link" to={`/employees/${row.id}`}>{name}</Link>
                          {isAdmin ? (
                            <>
                              <input value={row.name_en || ''} onChange={(event) => onChangeCell(row.id, 'name_en', event.target.value)} placeholder={lang === 'ar' ? 'الاسم الإنجليزي' : 'English name'} />
                              {statusByCell[`${row.id}:name_en`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:name_en`])}</span> : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {isAdmin ? (
                          <div className="cell-edit-wrap">
                            <input value={row.iqama_no || ''} onChange={(event) => onChangeCell(row.id, 'iqama_no', event.target.value)} />
                            {statusByCell[`${row.id}:iqama_no`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:iqama_no`])}</span> : null}
                          </div>
                        ) : (row.iqama_no || '-')}
                      </td>
                      <td>
                        {isAdmin ? (
                          <div className="cell-edit-wrap">
                            <input value={row.job_title || ''} onChange={(event) => onChangeCell(row.id, 'job_title', event.target.value)} />
                            {statusByCell[`${row.id}:job_title`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:job_title`])}</span> : null}
                          </div>
                        ) : (row.job_title || '-')}
                      </td>
                      <td>
                        {isAdmin ? (
                          <div className="cell-edit-wrap">
                            <input value={row.nationality || ''} onChange={(event) => onChangeCell(row.id, 'nationality', event.target.value)} />
                            {statusByCell[`${row.id}:nationality`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:nationality`])}</span> : null}
                          </div>
                        ) : (row.nationality || '-')}
                      </td>
                      <td>
                        {isAdmin ? (
                          <div className="cell-edit-wrap">
                            <select value={row.project_id || ''} onChange={(event) => onChangeCell(row.id, 'project_id', event.target.value)}>
                              <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                              {projectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            {statusByCell[`${row.id}:project_id`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:project_id`])}</span> : null}
                          </div>
                        ) : projectLabel}
                      </td>
                      <td>
                        {isAdmin ? (
                          <div className="cell-edit-wrap">
                            <select value={row.status || ''} onChange={(event) => onChangeCell(row.id, 'status', event.target.value)}>
                              <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                              {employeeStatusOptions(lang).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            {statusByCell[`${row.id}:status`] ? <span className="save-pill">{statusText(statusByCell[`${row.id}:status`])}</span> : null}
                          </div>
                        ) : (employeeStatusOptions(lang).find((opt) => opt.value === row.status)?.label || row.status || '-')}
                      </td>
                      <td>
                        {docsCount > 0 ? <span className="status-pill warning">{docsCount}</span> : <span className="card-sub">0</span>}
                      </td>
                      {isAdmin ? (
                        <td>
                          <button className="btn secondary" type="button" onClick={() => deleteEmployee(row)}>
                            {lang === 'ar' ? 'حذف' : 'Delete'}
                          </button>
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

      <RecordFormModal
        open={openAdd && isAdmin}
        title={lang === 'ar' ? 'إضافة موظف' : 'Add Employee'}
        columns={addColumns}
        initialValues={{ status: 'active', is_on_sponsorship: 'false' }}
        submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
        onClose={() => setOpenAdd(false)}
        onSubmit={addEmployee}
        lang={lang}
      />
    </div>
  )
}