import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import RecordFormModal from '../components/RecordFormModal'
import ExpiryMonitorPanel from '../components/ExpiryMonitorPanel'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import DataTable from '../components/ui/DataTable'
import StatusPill from '../components/ui/StatusPill'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
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

  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

  const inputClass = 'w-full rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm text-[var(--ds-text)]'

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'تحميل الموظفين...' : 'Loading employees...'}</div>
        </Card>
      </div>
    )
  }

  const rows = employees.map((row) => {
    const docsCount = countEmployeeSoonDocs(employeeDocuments.get(row.id) || [])
    const name = formatEmployeeName(row, lang)
    const projectLabel = formatProjectName(projectById[row.project_id], lang)

    return {
      id: row.id,
      name,
      iqama_no: row.iqama_no || '-',
      job_title: row.job_title || '-',
      nationality: row.nationality || '-',
      projectLabel,
      row,
      docsCount,
      statusValue: employeeStatusOptions(lang).find((opt) => opt.value === row.status)?.label || row.status || '-',
    }
  })

  const columns = [
    {
      key: 'name',
      label: lang === 'ar' ? 'الاسم' : 'Name',
      render: (record) => (
        <div className="space-y-1">
          <Link className="ds-link font-semibold" to={`/employees/${record.id}`}>{record.name}</Link>
          {isAdmin ? (
            <>
              <input className={inputClass} value={record.row.name_en || ''} onChange={(event) => onChangeCell(record.id, 'name_en', event.target.value)} placeholder={lang === 'ar' ? 'الاسم الإنجليزي' : 'English name'} />
              {statusByCell[`${record.id}:name_en`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:name_en`])}</span> : null}
            </>
          ) : null}
        </div>
      ),
    },
    {
      key: 'iqama_no',
      label: lang === 'ar' ? 'رقم الإقامة' : 'Iqama No',
      render: (record) => isAdmin ? (
        <div className="space-y-1">
          <input className={inputClass} value={record.row.iqama_no || ''} onChange={(event) => onChangeCell(record.id, 'iqama_no', event.target.value)} />
          {statusByCell[`${record.id}:iqama_no`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:iqama_no`])}</span> : null}
        </div>
      ) : record.iqama_no,
    },
    {
      key: 'job_title',
      label: lang === 'ar' ? 'المسمى الوظيفي' : 'Job Title',
      render: (record) => isAdmin ? (
        <div className="space-y-1">
          <input className={inputClass} value={record.row.job_title || ''} onChange={(event) => onChangeCell(record.id, 'job_title', event.target.value)} />
          {statusByCell[`${record.id}:job_title`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:job_title`])}</span> : null}
        </div>
      ) : record.job_title,
    },
    {
      key: 'nationality',
      label: lang === 'ar' ? 'الجنسية' : 'Nationality',
      render: (record) => isAdmin ? (
        <div className="space-y-1">
          <input className={inputClass} value={record.row.nationality || ''} onChange={(event) => onChangeCell(record.id, 'nationality', event.target.value)} />
          {statusByCell[`${record.id}:nationality`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:nationality`])}</span> : null}
        </div>
      ) : record.nationality,
    },
    {
      key: 'projectLabel',
      label: lang === 'ar' ? 'المشروع' : 'Project',
      render: (record) => isAdmin ? (
        <div className="space-y-1">
          <select className={inputClass} value={record.row.project_id || ''} onChange={(event) => onChangeCell(record.id, 'project_id', event.target.value)}>
            <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
            {projectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          {statusByCell[`${record.id}:project_id`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:project_id`])}</span> : null}
        </div>
      ) : record.projectLabel,
    },
    {
      key: 'statusValue',
      label: lang === 'ar' ? 'الحالة' : 'Status',
      render: (record) => isAdmin ? (
        <div className="space-y-1">
          <select className={inputClass} value={record.row.status || ''} onChange={(event) => onChangeCell(record.id, 'status', event.target.value)}>
            <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
            {employeeStatusOptions(lang).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          {statusByCell[`${record.id}:status`] ? <span className="text-xs text-[var(--ds-muted)]">{statusText(statusByCell[`${record.id}:status`])}</span> : null}
        </div>
      ) : <StatusPill status={record.row.status || 'draft'} lang={lang} label={record.statusValue} />,
    },
    {
      key: 'docsCount',
      label: lang === 'ar' ? 'وثائق قريبة الانتهاء' : 'Docs Expiring Soon',
      render: (record) => (
        <StatusPill
          status={record.docsCount > 0 ? 'warning' : 'ok'}
          lang={lang}
          label={record.docsCount > 0 ? (lang === 'ar' ? 'قريب الانتهاء' : 'Expiring Soon') : (lang === 'ar' ? 'سليم' : 'OK')}
          note={String(record.docsCount)}
        />
      ),
    },
  ]

  if (isAdmin) {
    columns.push({
      key: 'actions',
      label: lang === 'ar' ? 'حذف' : 'Delete',
      render: (record) => (
        <Button variant="danger" size="sm" onClick={() => deleteEmployee(record.row)}>
          {lang === 'ar' ? 'حذف' : 'Delete'}
        </Button>
      ),
    })
  }

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={lang === 'ar' ? 'الموظفون' : 'Employees'}
        subtitle={lang === 'ar' ? 'سجل الموظفين وخزنة المستندات ومتابعة الانتهاء.' : 'Employee registry, document vault, and expiry monitoring.'}
        dateText={todayLabel}
      />

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      ) : null}

      <div className="mt-4">
        <ExpiryMonitorPanel
          lang={lang}
          title={lang === 'ar' ? 'تنبيهات انتهاء الإقامات وتصاريح العمل' : 'Iqama & Work-Permit Expiry Monitor'}
          summary={expirySummary}
          items={urgentDocuments}
          emptyLabel={lang === 'ar' ? 'لا توجد مستندات منتهية أو على وشك الانتهاء خلال 90 يومًا.' : 'No employee documents are expired or due within 90 days.'}
        />
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--ds-text)]">{lang === 'ar' ? 'سجل الموظفين' : 'Employee Registry'}</h3>
          {isAdmin ? (
            <Button type="button" onClick={() => setOpenAdd(true)}>
              {lang === 'ar' ? 'إضافة موظف' : 'Add Employee'}
            </Button>
          ) : null}
        </div>

        {employees.length === 0 ? (
          <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'لا يوجد موظفون بعد.' : 'No employees yet.'}</div>
        ) : (
          <DataTable columns={columns} rows={rows} />
        )}
      </Card>

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