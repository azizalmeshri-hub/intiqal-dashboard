import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

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
    return <div className="card"><div className="card-label">{lang === 'ar' ? 'تحميل الرواتب...' : 'Loading payroll...'}</div></div>
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'الرواتب' : 'Payroll'}</h1>
      <div className="card" style={{ marginTop: 12, borderColor: '#8f6a2f' }}>
        <div className="tag-note" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>
          {lang === 'ar'
            ? 'معدلات التأمينات وحسابات مكافأة نهاية الخدمة تقديرية وفق المعادلات القياسية والإعدادات أعلاه. أكِّد المعدلات وتعريف الأجر والقواعد مع المحاسب أو مستشار العمل قبل الاعتماد للدفع أو التسويات الفعلية.'
            : 'GOSI rates and EOSB calculations are estimates based on standard formulas and the settings above. Confirm current rates, wage definitions, and rules with your accountant / labor consultant before using for actual payments or settlements.'}
        </div>
      </div>

      {!canWrite ? (
        <div className="tag-note" style={{ marginTop: 10, color: 'var(--amber)', background: 'var(--amber-dim)' }}>
          {lang === 'ar' ? `عرض فقط. الدور الحالي: ${role}` : `Read-only mode. Current role: ${role}`}
        </div>
      ) : null}

      {error ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
        </div>
      ) : null}

      {info ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--green)', background: 'var(--green-dim)' }}>{info}</div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'الإعدادات' : 'Settings'}</div>
        <div className="card-sub" style={{ marginBottom: 8 }}>
          {lang === 'ar' ? 'CONFIRM current GOSI rates with your accountant.' : 'CONFIRM current GOSI rates with your accountant.'}
        </div>
        <div className="form-grid">
          <div>
            <div className="card-label">{lang === 'ar' ? 'معدل GOSI الموظف' : 'GOSI employee rate'}</div>
            <input
              value={settingsDraft.gosiEmployeeRate}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiEmployeeRate: e.target.value }))}
              disabled={!canWrite}
            />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'معدل GOSI صاحب العمل' : 'GOSI employer rate'}</div>
            <input
              value={settingsDraft.gosiEmployerRate}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiEmployerRate: e.target.value }))}
              disabled={!canWrite}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="card-label">{lang === 'ar' ? 'ملاحظة GOSI' : 'GOSI note'}</div>
          <input
            value={settingsDraft.gosiNote}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, gosiNote: e.target.value }))}
            disabled={!canWrite}
          />
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>
          {lang === 'ar' ? 'قواعد EOSB' : 'EOSB Rules'}
        </div>

        <div className="card-sub" style={{ marginBottom: 8 }}>
          {lang === 'ar' ? 'الأجر المستخدم في احتساب مكافأة نهاية الخدمة' : 'Wage components used in EOSB calculations'}
        </div>

        <div className="employee-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settingsDraft.eosbRules.wage_includes.base}
              disabled={!canWrite}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  wage_includes: { ...prev.eosbRules.wage_includes, base: e.target.checked },
                },
              }))}
            />
            {lang === 'ar' ? 'الراتب الأساسي' : 'Base salary'}
          </label>
          <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settingsDraft.eosbRules.wage_includes.housing}
              disabled={!canWrite}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  wage_includes: { ...prev.eosbRules.wage_includes, housing: e.target.checked },
                },
              }))}
            />
            {lang === 'ar' ? 'بدل السكن' : 'Housing allowance'}
          </label>
          <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settingsDraft.eosbRules.wage_includes.transport}
              disabled={!canWrite}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  wage_includes: { ...prev.eosbRules.wage_includes, transport: e.target.checked },
                },
              }))}
            />
            {lang === 'ar' ? 'بدل النقل' : 'Transport allowance'}
          </label>
          <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settingsDraft.eosbRules.wage_includes.other}
              disabled={!canWrite}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  wage_includes: { ...prev.eosbRules.wage_includes, other: e.target.checked },
                },
              }))}
            />
            {lang === 'ar' ? 'بدلات أخرى' : 'Other allowance'}
          </label>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <div>
            <div className="card-label">{lang === 'ar' ? 'استقالة أقل من سنتين' : 'Resignation < 2 years'}</div>
            <input
              value={settingsDraft.eosbRules.resignation_tiers.lt2}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  resignation_tiers: { ...prev.eosbRules.resignation_tiers, lt2: toNum(e.target.value) },
                },
              }))}
              disabled={!canWrite}
            />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'استقالة 2 إلى 5 سنوات' : 'Resignation 2 to 5 years'}</div>
            <input
              value={settingsDraft.eosbRules.resignation_tiers.twoToFive}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  resignation_tiers: { ...prev.eosbRules.resignation_tiers, twoToFive: toNum(e.target.value) },
                },
              }))}
              disabled={!canWrite}
            />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'استقالة 5 إلى 10 سنوات' : 'Resignation 5 to 10 years'}</div>
            <input
              value={settingsDraft.eosbRules.resignation_tiers.fiveToTen}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  resignation_tiers: { ...prev.eosbRules.resignation_tiers, fiveToTen: toNum(e.target.value) },
                },
              }))}
              disabled={!canWrite}
            />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'استقالة 10+ سنوات' : 'Resignation >= 10 years'}</div>
            <input
              value={settingsDraft.eosbRules.resignation_tiers.gte10}
              onChange={(e) => setSettingsDraft((prev) => ({
                ...prev,
                eosbRules: {
                  ...prev.eosbRules,
                  resignation_tiers: { ...prev.eosbRules.resignation_tiers, gte10: toNum(e.target.value) },
                },
              }))}
              disabled={!canWrite}
            />
          </div>
        </div>

        <div className="employee-actions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={saveSettings} disabled={!canWrite || savingSettings}>
            {savingSettings
              ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
              : (lang === 'ar' ? 'حفظ الإعدادات' : 'Save Settings')}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'مسير رواتب شهري' : 'Monthly Payroll Run'}</div>

        {!activeEmployees.length ? (
          <div className="tag-note" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>
            {lang === 'ar' ? 'لا يوجد موظفون نشطون. أضف موظفين أولًا.' : 'No active employees yet. Add employees first.'}
          </div>
        ) : null}

        <div className="form-grid" style={{ marginTop: 10 }}>
          <div>
            <div className="card-label">{lang === 'ar' ? 'شهر المسير الجديد' : 'New run month'}</div>
            <input type="month" value={newRunMonth} onChange={(e) => setNewRunMonth(e.target.value)} />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'المسيرات الموجودة' : 'Existing runs'}</div>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
            >
              <option value="">{lang === 'ar' ? 'اختر مسيرًا' : 'Select a run'}</option>
              {payrollRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {`${toDateInput(run.period_month)} - ${statusLabel(run.status, lang)}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="employee-actions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={createNewRun} disabled={!canWrite || creatingRun || !activeEmployees.length}>
            {creatingRun
              ? (lang === 'ar' ? 'جارٍ الإنشاء...' : 'Creating...')
              : (lang === 'ar' ? 'إنشاء مسير جديد' : 'Create New Payroll Run')}
          </button>
        </div>

        {selectedRun ? (
          <>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div>
                <div className="card-label">{lang === 'ar' ? 'حالة المسير' : 'Run status'}</div>
                <select value={selectedRunStatus} onChange={(e) => setSelectedRunStatus(e.target.value)} disabled={!canWrite}>
                  {RUN_STATUSES.map((status) => (
                    <option key={status} value={status}>{statusLabel(status, lang)}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="card-label">{lang === 'ar' ? 'الفترة' : 'Period'}</div>
                <div className="card-value mono" style={{ fontSize: 18 }}>
                  {monthFmt.format(new Date(toDateInput(selectedRun.period_month)))}
                </div>
              </div>
            </div>

            <div className="grid grid-3" style={{ marginTop: 12 }}>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'عدد الموظفين' : 'Headcount'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{runSummary.headcount}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'إجمالي Gross' : 'Total gross'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{money.format(runSummary.gross)} SAR</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'إجمالي الاستقطاعات' : 'Total deductions'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{money.format(runSummary.deductions)} SAR</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'صافي الرواتب' : 'Total net'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{money.format(runSummary.net)} SAR</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'GOSI صاحب العمل' : 'Total employer GOSI'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{money.format(runSummary.employerGosi)} SAR</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="card-label">{lang === 'ar' ? 'تكلفة الشركة' : 'Company cost'}</div>
                <div className="card-value mono" style={{ fontSize: 22 }}>{money.format(runSummary.net + runSummary.employerGosi)} SAR</div>
              </div>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{lang === 'ar' ? 'الموظف' : 'Employee'}</th>
                    <th>{lang === 'ar' ? 'الأساسي' : 'Base'}</th>
                    <th>{lang === 'ar' ? 'البدلات' : 'Allowances'}</th>
                    <th>{lang === 'ar' ? 'GOSI موظف' : 'GOSI employee'}</th>
                    <th>{lang === 'ar' ? 'GOSI صاحب العمل' : 'GOSI employer'}</th>
                    <th>{lang === 'ar' ? 'استقطاعات إضافية' : 'Manual deductions'}</th>
                    <th>{lang === 'ar' ? 'إجمالي الاستقطاعات' : 'Total deductions'}</th>
                    <th>{lang === 'ar' ? 'الصافي' : 'Net pay'}</th>
                    <th>{lang === 'ar' ? 'قسيمة' : 'Payslip'}</th>
                  </tr>
                </thead>
                <tbody>
                  {runLines.map((line) => (
                    <tr key={line.id}>
                      <td>{employeeName(employeeById[line.employee_id], lang)}</td>
                      <td><input value={line.base} onChange={(e) => updateLine(line.id, 'base', e.target.value)} disabled={!canWrite} /></td>
                      <td><input value={line.allowances} onChange={(e) => updateLine(line.id, 'allowances', e.target.value)} disabled={!canWrite} /></td>
                      <td><input value={line.gosi_employee} onChange={(e) => updateLine(line.id, 'gosi_employee', e.target.value)} disabled={!canWrite} /></td>
                      <td><input value={line.gosi_employer} onChange={(e) => updateLine(line.id, 'gosi_employer', e.target.value)} disabled={!canWrite} /></td>
                      <td><input value={line.manual_deductions} onChange={(e) => updateLine(line.id, 'manual_deductions', e.target.value)} disabled={!canWrite} /></td>
                      <td className="num mono">{money.format(toNum(line.deductions))}</td>
                      <td className="num mono">{money.format(toNum(line.net_pay))}</td>
                      <td>
                        <button className="btn secondary" type="button" onClick={() => setSelectedPayslipLineId(line.id)}>
                          {lang === 'ar' ? 'عرض' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!runLines.length ? (
                    <tr>
                      <td colSpan={9} className="card-sub">{lang === 'ar' ? 'لا توجد بنود لهذا المسير.' : 'No lines in this run.'}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="employee-actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={saveRunChanges} disabled={!canWrite || savingRun || !runLines.length}>
                {savingRun
                  ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : (lang === 'ar' ? 'حفظ المسير' : 'Save Payroll Run')}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'قسيمة الراتب' : 'Payslip'}</div>
        {selectedPayslipLine && selectedPayslipEmployee ? (
          <div style={{ marginTop: 10 }}>
            <div className="info-row"><span>{lang === 'ar' ? 'الموظف' : 'Employee'}</span><span>{employeeName(selectedPayslipEmployee, lang)}</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'الشهر' : 'Month'}</span><span>{selectedRun ? monthFmt.format(new Date(toDateInput(selectedRun.period_month))) : '-'}</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'الأساسي' : 'Base salary'}</span><span className="mono">{money.format(toNum(selectedPayslipLine.base))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'بدل السكن' : 'Housing allowance'}</span><span className="mono">{money.format(toNum(selectedPayslipEmployee.housing_allow))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'بدل النقل' : 'Transport allowance'}</span><span className="mono">{money.format(toNum(selectedPayslipEmployee.transport_allow))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'بدلات أخرى' : 'Other allowance'}</span><span className="mono">{money.format(toNum(selectedPayslipEmployee.other_allow))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'إجمالي البدلات' : 'Total allowances'}</span><span className="mono">{money.format(toNum(selectedPayslipLine.allowances))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'GOSI الموظف' : 'Employee GOSI'}</span><span className="mono">{money.format(toNum(selectedPayslipLine.gosi_employee))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'الاستقطاعات' : 'Deductions'}</span><span className="mono">{money.format(toNum(selectedPayslipLine.deductions))} SAR</span></div>
            <div className="info-row"><span>{lang === 'ar' ? 'الصافي' : 'Net pay'}</span><span className="mono">{money.format(toNum(selectedPayslipLine.net_pay))} SAR</span></div>

            <div className="employee-actions" style={{ marginTop: 12 }}>
              <button className="btn secondary" type="button" onClick={() => window.print()}>
                {lang === 'ar' ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card-sub">{lang === 'ar' ? 'اختر سطرًا من المسير لعرض القسيمة.' : 'Select a payroll line to preview payslip.'}</div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'مخصص مكافأة نهاية الخدمة (EOSB)' : 'EOSB Accrual'}</div>
        <div className="info-row">
          <span>{lang === 'ar' ? 'مخصص الشركة (التزام)' : 'Company EOSB provision (liability)'}</span>
          <span className="mono">{money.format(eosbProvision)} SAR</span>
        </div>

        <div className="employee-actions" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={saveEosbProvision} disabled={!canWrite || savingProvision}>
            {savingProvision
              ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
              : (lang === 'ar' ? 'حفظ المخصص في app_settings' : 'Save provision to app_settings')}
          </button>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'الموظف' : 'Employee'}</th>
                <th>{lang === 'ar' ? 'المدة (سنوات)' : 'Tenure (years)'}</th>
                <th>{lang === 'ar' ? 'الأجر المعتمد' : 'Wage used'}</th>
                <th>{lang === 'ar' ? 'Full gratuity' : 'Full gratuity'}</th>
                <th>{lang === 'ar' ? 'Resignation-adjusted' : 'Resignation-adjusted'}</th>
              </tr>
            </thead>
            <tbody>
              {eosbRows.map((row) => (
                <tr key={row.employee.id}>
                  <td>{employeeName(row.employee, lang)}</td>
                  <td className="num mono">{row.years.toFixed(2)}</td>
                  <td className="num mono">{money.format(row.wage)}</td>
                  <td className="num mono">{money.format(row.fullGratuity)}</td>
                  <td className="num mono">{money.format(row.resignationAdjusted)}</td>
                </tr>
              ))}
              {!eosbRows.length ? (
                <tr><td colSpan={5} className="card-sub">{lang === 'ar' ? 'لا يوجد موظفون نشطون.' : 'No active employees found.'}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
