import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import KpiCard from '../components/ui/KpiCard'
import DataTable from '../components/ui/DataTable'
import StatusPill from '../components/ui/StatusPill'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'

const RUN_STATUSES = ['draft', 'approved', 'paid']

const DEFAULT_EOSB_RULES = {
  resignation_tiers: {
    lt2: 0,
    twoToFive: 1 / 3,
    fiveToTen: 2 / 3,
    gte10: 1,
  },
  wage_includes: {
    base: true,
    housing: true,
    transport: true,
    other: false,
  },
}

function toNum(value) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function toDateInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function monthToStart(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number)
  if (!year || !month) return ''
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseRules(value) {
  if (!value) return DEFAULT_EOSB_RULES
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return DEFAULT_EOSB_RULES
    }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || !parsed) {
    return DEFAULT_EOSB_RULES
  }

  const resignation = parsed.resignation_tiers || {}
  const wageIncludes = parsed.wage_includes || {}

  return {
    resignation_tiers: {
      lt2: toNum(resignation.lt2 ?? DEFAULT_EOSB_RULES.resignation_tiers.lt2),
      twoToFive: toNum(resignation.twoToFive ?? DEFAULT_EOSB_RULES.resignation_tiers.twoToFive),
      fiveToTen: toNum(resignation.fiveToTen ?? DEFAULT_EOSB_RULES.resignation_tiers.fiveToTen),
      gte10: toNum(resignation.gte10 ?? DEFAULT_EOSB_RULES.resignation_tiers.gte10),
    },
    wage_includes: {
      base: wageIncludes.base !== false,
      housing: wageIncludes.housing !== false,
      transport: wageIncludes.transport !== false,
      other: Boolean(wageIncludes.other),
    },
  }
}

function employeeName(employee, lang) {
  if (!employee) return '-'
  return lang === 'ar'
    ? (employee.name_ar || employee.name_en || employee.id)
    : (employee.name_en || employee.name_ar || employee.id)
}

function isSaudiForGosi(employee) {
  const nationality = String(employee?.nationality || '').toLowerCase()
  const byNationality = nationality.includes('saudi') || nationality.includes('سعود')
  const sponsorshipFlag = employee?.is_on_sponsorship
  const bySponsorship = sponsorshipFlag === false
  return byNationality || bySponsorship
}

function calcYearsSince(hireDate) {
  if (!hireDate) return 0
  const d = new Date(hireDate)
  if (!Number.isFinite(d.getTime())) return 0
  const now = new Date()
  const years = (now.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  return years > 0 ? years : 0
}

function resignationFactor(years, tiers) {
  if (years < 2) return toNum(tiers.lt2)
  if (years < 5) return toNum(tiers.twoToFive)
  if (years < 10) return toNum(tiers.fiveToTen)
  return toNum(tiers.gte10)
}

function runTotals(lines) {
  return (lines || []).reduce((acc, line) => {
    const base = toNum(line.base)
    const allowances = toNum(line.allowances)
    const deductions = toNum(line.deductions)
    const net = toNum(line.net_pay)
    const employerGosi = toNum(line.gosi_employer)

    acc.headcount += 1
    acc.gross += base + allowances
    acc.deductions += deductions
    acc.net += net
    acc.employerGosi += employerGosi
    return acc
  }, { headcount: 0, gross: 0, deductions: 0, net: 0, employerGosi: 0 })
}

function statusLabel(status, lang) {
  const map = {
    draft: { en: 'Draft', ar: 'مسودة' },
    approved: { en: 'Approved', ar: 'معتمد' },
    paid: { en: 'Paid', ar: 'مدفوع' },
  }
  const row = map[String(status || '').toLowerCase()]
  if (!row) return status || '-'
  return lang === 'ar' ? row.ar : row.en
}

export default function Payroll() {
  const { lang } = useLang()
  const { role } = useAuth()
  const canWrite = role === 'admin'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [employees, setEmployees] = useState([])
  const [payrollRuns, setPayrollRuns] = useState([])
  const [runLines, setRunLines] = useState([])

  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedRunStatus, setSelectedRunStatus] = useState('draft')
  const [newRunMonth, setNewRunMonth] = useState(getCurrentMonth())

  const [settingsDraft, setSettingsDraft] = useState({
    gosiEmployeeRate: '0.00',
    gosiEmployerRate: '0.00',
    gosiNote: '',
    eosbRules: DEFAULT_EOSB_RULES,
  })

  const [savingSettings, setSavingSettings] = useState(false)
  const [creatingRun, setCreatingRun] = useState(false)
  const [savingRun, setSavingRun] = useState(false)
  const [savingProvision, setSavingProvision] = useState(false)
  const [selectedPayslipLineId, setSelectedPayslipLineId] = useState('')

  useEffect(() => {
    let active = true

    const loadAll = async () => {
      setLoading(true)
      setError('')
      setInfo('')
      try {
        const [employeesRes, runsRes, settingsRes] = await Promise.all([
          supabase
            .from('employees')
            .select('id,name_ar,name_en,nationality,base_salary,housing_allow,transport_allow,other_allow,hire_date,status,contract_type,is_on_sponsorship,project_id,deleted_at')
            .is('deleted_at', null)
            .order('name_en', { ascending: true }),
          supabase
            .from('payroll_runs')
            .select('id,period_month,status,total_gross,total_net,created_at')
            .order('period_month', { ascending: false }),
          supabase
            .from('app_settings')
            .select('key,value')
            .in('key', ['gosi_employee_rate', 'gosi_employer_rate', 'gosi_note', 'eosb_rules']),
        ])

        const errs = [employeesRes.error, runsRes.error, settingsRes.error].filter(Boolean)
        if (errs.length) throw errs[0]
        if (!active) return

        const nextEmployees = employeesRes.data || []
        const nextRuns = runsRes.data || []
        const settings = Object.fromEntries((settingsRes.data || []).map((row) => [row.key, row.value]))
        const nextRules = parseRules(settings.eosb_rules)

        setEmployees(nextEmployees)
        setPayrollRuns(nextRuns)
        setSettingsDraft({
          gosiEmployeeRate: String(toNum(settings.gosi_employee_rate).toFixed(4)),
          gosiEmployerRate: String(toNum(settings.gosi_employer_rate).toFixed(4)),
          gosiNote: String(settings.gosi_note || ''),
          eosbRules: nextRules,
        })

        if (nextRuns.length) {
          setSelectedRunId((prev) => prev || nextRuns[0].id)
          setSelectedRunStatus(nextRuns[0].status || 'draft')
        } else {
          setSelectedRunId('')
          setSelectedRunStatus('draft')
        }
      } catch (err) {
        if (!active) return
        setError(err?.message || (lang === 'ar' ? 'تعذر تحميل بيانات الرواتب.' : 'Failed to load payroll data.'))
      } finally {
        if (active) setLoading(false)
      }
    }

    loadAll()
    return () => { active = false }
  }, [lang])

  useEffect(() => {
    let active = true

    const loadLines = async () => {
      if (!selectedRunId) {
        setRunLines([])
        return
      }

      try {
        const { data, error: linesError } = await supabase
          .from('payroll_lines')
          .select('id,payroll_run_id,employee_id,base,allowances,deductions,gosi_employee,gosi_employer,net_pay')
          .eq('payroll_run_id', selectedRunId)
          .order('employee_id', { ascending: true })
        if (linesError) throw linesError
        if (!active) return

        const normalized = (data || []).map((row) => {
          const manualDeductions = Math.max(0, toNum(row.deductions) - toNum(row.gosi_employee))
          return {
            ...row,
            manual_deductions: manualDeductions,
          }
        })

        setRunLines(normalized)
        setSelectedPayslipLineId((prev) => prev || normalized[0]?.id || '')
      } catch (err) {
        if (!active) return
        setError(err?.message || (lang === 'ar' ? 'تعذر تحميل بنود مسير الرواتب.' : 'Failed to load payroll lines.'))
      }
    }

    loadLines()
    return () => { active = false }
  }, [selectedRunId, lang])

  const employeeById = useMemo(() => Object.fromEntries(employees.map((row) => [row.id, row])), [employees])

  const activeEmployees = useMemo(() => {
    return employees.filter((row) => String(row.status || '').toLowerCase() === 'active')
  }, [employees])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric',
    month: 'long',
  }), [lang])

  const selectedRun = useMemo(() => payrollRuns.find((row) => row.id === selectedRunId) || null, [payrollRuns, selectedRunId])

  useEffect(() => {
    if (selectedRun) {
      setSelectedRunStatus(selectedRun.status || 'draft')
    }
  }, [selectedRun?.id, selectedRun?.status])

  const gosiEmployeeRate = toNum(settingsDraft.gosiEmployeeRate)
  const gosiEmployerRate = toNum(settingsDraft.gosiEmployerRate)
  const runSummary = useMemo(() => runTotals(runLines), [runLines])

  const eosbRows = useMemo(() => {
    const rules = settingsDraft.eosbRules || DEFAULT_EOSB_RULES
    const wageIncludes = rules.wage_includes || DEFAULT_EOSB_RULES.wage_includes
    const tiers = rules.resignation_tiers || DEFAULT_EOSB_RULES.resignation_tiers

    return activeEmployees.map((employee) => {
      const base = toNum(employee.base_salary)
      const housing = toNum(employee.housing_allow)
      const transport = toNum(employee.transport_allow)
      const other = toNum(employee.other_allow)

      const wage =
        (wageIncludes.base ? base : 0) +
        (wageIncludes.housing ? housing : 0) +
        (wageIncludes.transport ? transport : 0) +
        (wageIncludes.other ? other : 0)

      const years = calcYearsSince(employee.hire_date)
      const baseGratuity = (0.5 * wage * Math.min(years, 5)) + (1.0 * wage * Math.max(years - 5, 0))
      const fullGratuity = baseGratuity
      const factor = resignationFactor(years, tiers)
      const resignationAdjusted = fullGratuity * factor

      return {
        employee,
        years,
        wage,
        fullGratuity,
        resignationAdjusted,
      }
    })
  }, [activeEmployees, settingsDraft.eosbRules])

  const eosbProvision = useMemo(() => eosbRows.reduce((sum, row) => sum + toNum(row.fullGratuity), 0), [eosbRows])

  const selectedPayslipLine = useMemo(() => runLines.find((row) => row.id === selectedPayslipLineId) || null, [runLines, selectedPayslipLineId])
  const selectedPayslipEmployee = selectedPayslipLine ? employeeById[selectedPayslipLine.employee_id] : null
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

  const saveSettings = async () => {
    if (!canWrite) return
    setSavingSettings(true)
    setError('')
    setInfo('')
    try {
      const payload = [
        { key: 'gosi_employee_rate', value: toNum(settingsDraft.gosiEmployeeRate) },
        { key: 'gosi_employer_rate', value: toNum(settingsDraft.gosiEmployerRate) },
        { key: 'gosi_note', value: settingsDraft.gosiNote || '' },
        { key: 'eosb_rules', value: settingsDraft.eosbRules || DEFAULT_EOSB_RULES },
      ]

      const { error: upsertError } = await supabase.from('app_settings').upsert(payload, { onConflict: 'key' })
      if (upsertError) throw upsertError
      setInfo(lang === 'ar' ? 'تم حفظ إعدادات الرواتب.' : 'Payroll settings saved.')
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ الإعدادات.' : 'Failed to save settings.'))
    } finally {
      setSavingSettings(false)
    }
  }

  const createNewRun = async () => {
    if (!canWrite) return
    setCreatingRun(true)
    setError('')
    setInfo('')

    try {
      const periodMonth = monthToStart(newRunMonth)
      if (!periodMonth) {
        throw new Error(lang === 'ar' ? 'اختر شهرًا صحيحًا.' : 'Choose a valid month.')
      }

      const alreadyExists = payrollRuns.some((row) => toDateInput(row.period_month) === periodMonth)
      if (alreadyExists) {
        throw new Error(lang === 'ar' ? 'مسير هذا الشهر موجود بالفعل.' : 'Payroll run for this month already exists.')
      }

      if (!activeEmployees.length) {
        throw new Error(lang === 'ar' ? 'لا يوجد موظفون نشطون. أضف موظفين أولًا.' : 'No active employees. Add employees first.')
      }

      const { data: runInserted, error: runInsertError } = await supabase
        .from('payroll_runs')
        .insert({
          period_month: periodMonth,
          status: 'draft',
          total_gross: 0,
          total_net: 0,
        })
        .select('id,period_month,status,total_gross,total_net,created_at')
        .single()

      if (runInsertError) throw runInsertError

      const linesPayload = activeEmployees.map((employee) => {
        const base = toNum(employee.base_salary)
        const allowances = toNum(employee.housing_allow) + toNum(employee.transport_allow) + toNum(employee.other_allow)
        const gosiEligible = isSaudiForGosi(employee)
        const gosiEmployee = gosiEligible ? (base * gosiEmployeeRate) : 0
        const gosiEmployer = gosiEligible ? (base * gosiEmployerRate) : (base * gosiEmployerRate)
        const deductions = gosiEmployee
        const netPay = base + allowances - deductions

        return {
          payroll_run_id: runInserted.id,
          employee_id: employee.id,
          base,
          allowances,
          deductions,
          gosi_employee: gosiEmployee,
          gosi_employer: gosiEmployer,
          net_pay: netPay,
        }
      })

      const { data: insertedLines, error: linesInsertError } = await supabase
        .from('payroll_lines')
        .insert(linesPayload)
        .select('id,payroll_run_id,employee_id,base,allowances,deductions,gosi_employee,gosi_employer,net_pay')

      if (linesInsertError) throw linesInsertError

      const totals = runTotals(insertedLines || [])
      const { data: runUpdated, error: runUpdateError } = await supabase
        .from('payroll_runs')
        .update({
          total_gross: totals.gross,
          total_net: totals.net,
        })
        .eq('id', runInserted.id)
        .select('id,period_month,status,total_gross,total_net,created_at')
        .single()

      if (runUpdateError) throw runUpdateError

      setPayrollRuns((prev) => [runUpdated, ...prev])
      setSelectedRunId(runUpdated.id)
      setSelectedRunStatus(runUpdated.status || 'draft')
      setRunLines((insertedLines || []).map((row) => ({
        ...row,
        manual_deductions: Math.max(0, toNum(row.deductions) - toNum(row.gosi_employee)),
      })))
      setSelectedPayslipLineId(insertedLines?.[0]?.id || '')
      setInfo(lang === 'ar' ? 'تم إنشاء مسير الرواتب.' : 'Payroll run created.')
      window.dispatchEvent(new Event('intiqal:data-changed'))
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر إنشاء مسير الرواتب.' : 'Failed to create payroll run.'))
    } finally {
      setCreatingRun(false)
    }
  }

  const updateLine = (lineId, field, rawValue) => {
    setRunLines((prev) => prev.map((line) => {
      if (line.id !== lineId) return line

      const next = { ...line }
      if (field === 'manual_deductions') {
        const manual = Math.max(0, toNum(rawValue))
        next.manual_deductions = manual
        next.deductions = toNum(next.gosi_employee) + manual
      } else {
        next[field] = toNum(rawValue)
        if (field === 'gosi_employee') {
          const manual = Math.max(0, toNum(next.manual_deductions))
          next.deductions = toNum(next.gosi_employee) + manual
        }
      }

      next.net_pay = toNum(next.base) + toNum(next.allowances) - toNum(next.deductions)
      return next
    }))
  }

  const saveRunChanges = async () => {
    if (!canWrite || !selectedRunId) return
    setSavingRun(true)
    setError('')
    setInfo('')

    try {
      const updates = runLines.map((line) => {
        const payload = {
          base: toNum(line.base),
          allowances: toNum(line.allowances),
          deductions: toNum(line.deductions),
          gosi_employee: toNum(line.gosi_employee),
          gosi_employer: toNum(line.gosi_employer),
          net_pay: toNum(line.net_pay),
        }
        return supabase.from('payroll_lines').update(payload).eq('id', line.id)
      })

      const results = await Promise.all(updates)
      const failed = results.find((res) => res.error)
      if (failed?.error) throw failed.error

      const totals = runTotals(runLines)
      const { data: runUpdated, error: runUpdateError } = await supabase
        .from('payroll_runs')
        .update({
          status: selectedRunStatus,
          total_gross: totals.gross,
          total_net: totals.net,
        })
        .eq('id', selectedRunId)
        .select('id,period_month,status,total_gross,total_net,created_at')
        .single()

      if (runUpdateError) throw runUpdateError

      setPayrollRuns((prev) => prev.map((row) => row.id === selectedRunId ? runUpdated : row))
      setInfo(lang === 'ar' ? 'تم حفظ مسير الرواتب.' : 'Payroll run saved.')
      window.dispatchEvent(new Event('intiqal:data-changed'))
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ مسير الرواتب.' : 'Failed to save payroll run.'))
    } finally {
      setSavingRun(false)
    }
  }

  const saveEosbProvision = async () => {
    if (!canWrite) return
    setSavingProvision(true)
    setError('')
    setInfo('')

    try {
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert({ key: 'eosb_provision', value: eosbProvision }, { onConflict: 'key' })

      if (upsertError) throw upsertError
      setInfo(lang === 'ar' ? 'تم حفظ مخصص EOSB في app_settings.' : 'EOSB provision saved to app_settings.')
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ مخصص EOSB.' : 'Failed to save EOSB provision.'))
    } finally {
      setSavingProvision(false)
    }
  }

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'تحميل الرواتب...' : 'Loading payroll...'}</div>
        </Card>
      </div>
    )
  }

  const inputClass = 'w-full rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm text-[var(--ds-text)]'

  const lineRows = runLines.map((line) => ({
    id: line.id,
    name: employeeName(employeeById[line.employee_id], lang),
    line,
    totalDeductions: money.format(toNum(line.deductions)),
    netPay: money.format(toNum(line.net_pay)),
  }))

  const lineColumns = [
    { key: 'name', label: lang === 'ar' ? 'الموظف' : 'Employee' },
    {
      key: 'base',
      label: lang === 'ar' ? 'الأساسي' : 'Base',
      render: (record) => <input className={inputClass} value={record.line.base} onChange={(e) => updateLine(record.id, 'base', e.target.value)} disabled={!canWrite} />,
    },
    {
      key: 'allowances',
      label: lang === 'ar' ? 'البدلات' : 'Allowances',
      render: (record) => <input className={inputClass} value={record.line.allowances} onChange={(e) => updateLine(record.id, 'allowances', e.target.value)} disabled={!canWrite} />,
    },
    {
      key: 'gosiEmployee',
      label: lang === 'ar' ? 'GOSI موظف' : 'GOSI employee',
      render: (record) => <input className={inputClass} value={record.line.gosi_employee} onChange={(e) => updateLine(record.id, 'gosi_employee', e.target.value)} disabled={!canWrite} />,
    },
    {
      key: 'gosiEmployer',
      label: lang === 'ar' ? 'GOSI صاحب العمل' : 'GOSI employer',
      render: (record) => <input className={inputClass} value={record.line.gosi_employer} onChange={(e) => updateLine(record.id, 'gosi_employer', e.target.value)} disabled={!canWrite} />,
    },
    {
      key: 'manualDeductions',
      label: lang === 'ar' ? 'استقطاعات إضافية' : 'Manual deductions',
      render: (record) => <input className={inputClass} value={record.line.manual_deductions} onChange={(e) => updateLine(record.id, 'manual_deductions', e.target.value)} disabled={!canWrite} />,
    },
    {
      key: 'totalDeductions',
      label: lang === 'ar' ? 'إجمالي الاستقطاعات' : 'Total deductions',
      render: (record) => <span className="ds-money">{record.totalDeductions}</span>,
    },
    {
      key: 'netPay',
      label: lang === 'ar' ? 'الصافي' : 'Net pay',
      render: (record) => <span className="ds-money">{record.netPay}</span>,
    },
    {
      key: 'payslip',
      label: lang === 'ar' ? 'قسيمة' : 'Payslip',
      render: (record) => (
        <Button variant="secondary" size="sm" onClick={() => setSelectedPayslipLineId(record.id)}>
          {lang === 'ar' ? 'عرض' : 'View'}
        </Button>
      ),
    },
  ]

  const eosbTableRows = eosbRows.map((row) => ({
    id: row.employee.id,
    employee: employeeName(row.employee, lang),
    years: row.years.toFixed(2),
    wage: money.format(row.wage),
    full: money.format(row.fullGratuity),
    adjusted: money.format(row.resignationAdjusted),
  }))

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={lang === 'ar' ? 'الرواتب' : 'Payroll'}
        subtitle={lang === 'ar' ? 'المسيرات الشهرية، القسائم، ومخصص نهاية الخدمة.' : 'Monthly runs, payslips, and EOSB accrual.'}
        dateText={todayLabel}
      />

      <Card className="mb-4 border-amber-200 bg-amber-50">
        <div className="text-sm font-semibold text-amber-700">
          {lang === 'ar'
            ? 'معدلات التأمينات وحسابات مكافأة نهاية الخدمة تقديرية وفق المعادلات القياسية والإعدادات أعلاه. أكِّد المعدلات وتعريف الأجر والقواعد مع المحاسب أو مستشار العمل قبل الاعتماد للدفع أو التسويات الفعلية.'
            : 'GOSI rates and EOSB calculations are estimates based on standard formulas and the settings above. Confirm current rates, wage definitions, and rules with your accountant / labor consultant before using for actual payments or settlements.'}
        </div>
      </Card>

      {!canWrite ? (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-sm font-semibold text-amber-700">{lang === 'ar' ? `عرض فقط. الدور الحالي: ${role}` : `Read-only mode. Current role: ${role}`}</div>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      ) : null}

      {info ? (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <div className="text-sm font-semibold text-emerald-700">{info}</div>
        </Card>
      ) : null}

      {canWrite ? (
        <Card className="mb-4">
          <CardTitle>{lang === 'ar' ? 'الإعدادات (مسؤول فقط)' : 'Settings (Admin Only)'}</CardTitle>
          <div className="mt-1 text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'CONFIRM current GOSI rates with your accountant.' : 'CONFIRM current GOSI rates with your accountant.'}</div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'معدل GOSI الموظف' : 'GOSI employee rate'}</div>
              <input className={inputClass} value={settingsDraft.gosiEmployeeRate} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiEmployeeRate: e.target.value }))} />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'معدل GOSI صاحب العمل' : 'GOSI employer rate'}</div>
              <input className={inputClass} value={settingsDraft.gosiEmployerRate} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiEmployerRate: e.target.value }))} />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'ملاحظة GOSI' : 'GOSI note'}</div>
            <input className={inputClass} value={settingsDraft.gosiNote} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiNote: e.target.value }))} />
          </div>

          <div className="mt-4 text-base font-bold text-[var(--ds-text)]">{lang === 'ar' ? 'قواعد EOSB' : 'EOSB Rules'}</div>
          <div className="mt-1 text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'الأجر المستخدم في احتساب مكافأة نهاية الخدمة' : 'Wage components used in EOSB calculations'}</div>

          <div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--ds-text)]">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={settingsDraft.eosbRules.wage_includes.base} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, wage_includes: { ...prev.eosbRules.wage_includes, base: e.target.checked } } }))} />{lang === 'ar' ? 'الراتب الأساسي' : 'Base salary'}</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={settingsDraft.eosbRules.wage_includes.housing} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, wage_includes: { ...prev.eosbRules.wage_includes, housing: e.target.checked } } }))} />{lang === 'ar' ? 'بدل السكن' : 'Housing allowance'}</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={settingsDraft.eosbRules.wage_includes.transport} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, wage_includes: { ...prev.eosbRules.wage_includes, transport: e.target.checked } } }))} />{lang === 'ar' ? 'بدل النقل' : 'Transport allowance'}</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={settingsDraft.eosbRules.wage_includes.other} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, wage_includes: { ...prev.eosbRules.wage_includes, other: e.target.checked } } }))} />{lang === 'ar' ? 'بدلات أخرى' : 'Other allowance'}</label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'استقالة أقل من سنتين' : 'Resignation < 2 years'}</div><input className={inputClass} value={settingsDraft.eosbRules.resignation_tiers.lt2} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, resignation_tiers: { ...prev.eosbRules.resignation_tiers, lt2: toNum(e.target.value) } } }))} /></div>
            <div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'استقالة 2 إلى 5 سنوات' : 'Resignation 2 to 5 years'}</div><input className={inputClass} value={settingsDraft.eosbRules.resignation_tiers.twoToFive} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, resignation_tiers: { ...prev.eosbRules.resignation_tiers, twoToFive: toNum(e.target.value) } } }))} /></div>
            <div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'استقالة 5 إلى 10 سنوات' : 'Resignation 5 to 10 years'}</div><input className={inputClass} value={settingsDraft.eosbRules.resignation_tiers.fiveToTen} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, resignation_tiers: { ...prev.eosbRules.resignation_tiers, fiveToTen: toNum(e.target.value) } } }))} /></div>
            <div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'استقالة 10+ سنوات' : 'Resignation >= 10 years'}</div><input className={inputClass} value={settingsDraft.eosbRules.resignation_tiers.gte10} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, eosbRules: { ...prev.eosbRules, resignation_tiers: { ...prev.eosbRules.resignation_tiers, gte10: toNum(e.target.value) } } }))} /></div>
          </div>

          <div className="mt-3">
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (lang === 'ar' ? 'حفظ الإعدادات' : 'Save Settings')}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardTitle>{lang === 'ar' ? 'مسير رواتب شهري' : 'Monthly Payroll Run'}</CardTitle>

        {!activeEmployees.length ? (
          <div className="mt-2 text-sm font-semibold text-amber-700">
            {lang === 'ar' ? 'لا يوجد موظفون نشطون. أضف موظفين أولًا.' : 'No active employees yet. Add employees first.'}
          </div>
        ) : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'شهر المسير الجديد' : 'New run month'}</div>
            <input className={inputClass} type="month" value={newRunMonth} onChange={(e) => setNewRunMonth(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'المسيرات الموجودة' : 'Existing runs'}</div>
            <select className={inputClass} value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
              <option value="">{lang === 'ar' ? 'اختر مسيرًا' : 'Select a run'}</option>
              {payrollRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {`${toDateInput(run.period_month)} - ${statusLabel(run.status, lang)}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <Button onClick={createNewRun} disabled={!canWrite || creatingRun || !activeEmployees.length}>
            {creatingRun
              ? (lang === 'ar' ? 'جارٍ الإنشاء...' : 'Creating...')
              : (lang === 'ar' ? 'إنشاء مسير جديد' : 'Create New Payroll Run')}
          </Button>
        </div>

        {selectedRun ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'حالة المسير' : 'Run status'}</div>
                <div className="flex items-center gap-2">
                  <select className={inputClass} value={selectedRunStatus} onChange={(e) => setSelectedRunStatus(e.target.value)} disabled={!canWrite}>
                  {RUN_STATUSES.map((status) => (
                    <option key={status} value={status}>{statusLabel(status, lang)}</option>
                  ))}
                  </select>
                  <StatusPill status={selectedRunStatus} lang={lang} />
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'الفترة' : 'Period'}</div>
                <div className="ds-money text-xl font-bold text-[var(--ds-text)]">
                  {monthFmt.format(new Date(toDateInput(selectedRun.period_month)))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard label={lang === 'ar' ? 'عدد الموظفين' : 'Headcount'} value={runSummary.headcount} />
              <KpiCard label={lang === 'ar' ? 'إجمالي Gross' : 'Total gross'} value={`${money.format(runSummary.gross)} SAR`} />
              <KpiCard label={lang === 'ar' ? 'إجمالي الاستقطاعات' : 'Total deductions'} value={`${money.format(runSummary.deductions)} SAR`} />
              <KpiCard label={lang === 'ar' ? 'صافي الرواتب' : 'Total net'} value={`${money.format(runSummary.net)} SAR`} />
              <KpiCard label={lang === 'ar' ? 'GOSI صاحب العمل' : 'Total employer GOSI'} value={`${money.format(runSummary.employerGosi)} SAR`} />
            </div>

            <div className="mt-4">
              {lineRows.length ? <DataTable columns={lineColumns} rows={lineRows} /> : <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'لا توجد بنود لهذا المسير.' : 'No lines in this run.'}</div>}
            </div>

            <div className="mt-3">
              <Button onClick={saveRunChanges} disabled={!canWrite || savingRun || !runLines.length}>
                {savingRun
                  ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : (lang === 'ar' ? 'حفظ المسير' : 'Save Payroll Run')}
              </Button>
            </div>
          </>
        ) : null}
      </Card>

      <Card className="mb-4">
        <CardTitle>{lang === 'ar' ? 'قسيمة الراتب' : 'Payslip'}</CardTitle>
        {selectedPayslipLine && selectedPayslipEmployee ? (
          <div className="mt-3">
            <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm print:shadow-none">
              <div className="mb-3 border-b border-slate-200 pb-3">
                <div className="text-lg font-bold">{lang === 'ar' ? 'قسيمة راتب' : 'Payslip'}</div>
                <div className="text-sm text-slate-500">{selectedRun ? monthFmt.format(new Date(toDateInput(selectedRun.period_month))) : '-'}</div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'الموظف' : 'Employee'}</span><span className="font-semibold">{employeeName(selectedPayslipEmployee, lang)}</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'الأساسي' : 'Base salary'}</span><span className="ds-money">{money.format(toNum(selectedPayslipLine.base))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'بدل السكن' : 'Housing allowance'}</span><span className="ds-money">{money.format(toNum(selectedPayslipEmployee.housing_allow))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'بدل النقل' : 'Transport allowance'}</span><span className="ds-money">{money.format(toNum(selectedPayslipEmployee.transport_allow))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'بدلات أخرى' : 'Other allowance'}</span><span className="ds-money">{money.format(toNum(selectedPayslipEmployee.other_allow))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'إجمالي البدلات' : 'Total allowances'}</span><span className="ds-money">{money.format(toNum(selectedPayslipLine.allowances))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'GOSI الموظف' : 'Employee GOSI'}</span><span className="ds-money">{money.format(toNum(selectedPayslipLine.gosi_employee))} SAR</span></div>
                <div className="flex items-center justify-between"><span>{lang === 'ar' ? 'الاستقطاعات' : 'Deductions'}</span><span className="ds-money">{money.format(toNum(selectedPayslipLine.deductions))} SAR</span></div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 font-bold"><span>{lang === 'ar' ? 'الصافي' : 'Net pay'}</span><span className="ds-money">{money.format(toNum(selectedPayslipLine.net_pay))} SAR</span></div>
              </div>
            </div>

            <div className="mt-3">
              <Button variant="secondary" type="button" onClick={() => window.print()}>
                {lang === 'ar' ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'اختر سطرًا من المسير لعرض القسيمة.' : 'Select a payroll line to preview payslip.'}</div>
        )}
      </Card>

      <Card>
        <CardTitle>{lang === 'ar' ? 'مخصص مكافأة نهاية الخدمة (EOSB)' : 'EOSB Accrual'}</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <KpiCard label={lang === 'ar' ? 'مخصص الشركة (التزام)' : 'Company EOSB provision (liability)'} value={`${money.format(eosbProvision)} SAR`} />
        </div>

        <div className="mt-3">
          <Button variant="secondary" onClick={saveEosbProvision} disabled={!canWrite || savingProvision}>
            {savingProvision
              ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
              : (lang === 'ar' ? 'حفظ المخصص في app_settings' : 'Save provision to app_settings')}
          </Button>
        </div>

        <div className="mt-4">
          {eosbTableRows.length ? (
            <DataTable
              columns={[
                { key: 'employee', label: lang === 'ar' ? 'الموظف' : 'Employee' },
                { key: 'years', label: lang === 'ar' ? 'المدة (سنوات)' : 'Tenure (years)', render: (row) => <span className="ds-money">{row.years}</span> },
                { key: 'wage', label: lang === 'ar' ? 'الأجر المعتمد' : 'Wage used', render: (row) => <span className="ds-money">{row.wage}</span> },
                { key: 'full', label: lang === 'ar' ? 'Full gratuity' : 'Full gratuity', render: (row) => <span className="ds-money">{row.full}</span> },
                { key: 'adjusted', label: lang === 'ar' ? 'Resignation-adjusted' : 'Resignation-adjusted', render: (row) => <span className="ds-money">{row.adjusted}</span> },
              ]}
              rows={eosbTableRows}
            />
          ) : (
            <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'لا يوجد موظفون نشطون.' : 'No active employees found.'}</div>
          )}
        </div>
      </Card>
    </div>
  )
}
