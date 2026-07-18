import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { calcVatForPeriod } from '../lib/calc'
import { formatEmployeeName, formatProjectName } from '../lib/employees'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import KpiCard from '../components/ui/KpiCard'
import DataTable from '../components/ui/DataTable'
import StatusPill from '../components/ui/StatusPill'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'

function toNum(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function toDateInputValue(value) {
  if (!value) return ''
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function monthRange(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number)
  if (!year || !month) return { start: '', end: '' }
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  return { start: toDateInputValue(first), end: toDateInputValue(last) }
}

function quarterRange(quarterKey) {
  const [yearStr, qStr] = String(quarterKey || '').split('-Q')
  const year = Number(yearStr)
  const q = Number(qStr)
  if (!year || !q || q < 1 || q > 4) return { start: '', end: '' }
  const startMonth = (q - 1) * 3
  const first = new Date(year, startMonth, 1)
  const last = new Date(year, startMonth + 3, 0)
  return { start: toDateInputValue(first), end: toDateInputValue(last) }
}

function getCurrentMonthKey() {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${m}`
}

function getCurrentQuarterKey() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3) + 1
  return `${now.getFullYear()}-Q${q}`
}

function csvEscape(value) {
  const raw = String(value ?? '')
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function buildCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

const PERIOD_STATUS = ['draft', 'filed', 'paid']
const DEBOUNCE_MS = 800

export default function VAT() {
  const { lang } = useLang()
  const { isAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

  const [clientInvoices, setClientInvoices] = useState([])
  const [supplierInvoices, setSupplierInvoices] = useState([])
  const [projects, setProjects] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [vatPeriods, setVatPeriods] = useState([])

  const [frequency, setFrequency] = useState('monthly')
  const [vatRate, setVatRate] = useState(0.15)

  const [periodMode, setPeriodMode] = useState('monthly')
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey())
  const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarterKey())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [saveState, setSaveState] = useState('')
  const [rowStatus, setRowStatus] = useState({})

  const pendingRef = useRef({})
  const timersRef = useRef({})

  useEffect(() => {
    return () => {
      for (const key of Object.keys(timersRef.current)) {
        clearTimeout(timersRef.current[key])
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [
          clientRes,
          supplierRes,
          projectsRes,
          suppliersRes,
          periodsRes,
          settingsRes,
        ] = await Promise.all([
          supabase
            .from('client_invoices')
            .select('id,invoice_no,invoice_number,invoice_date,project_id,amount_net,vat_amount,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('supplier_invoices')
            .select('id,invoice_no,invoice_number,invoice_date,supplier_id,amount_net,vat_amount,has_valid_tax_invoice,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('projects')
            .select('id,name_ar,name_en')
            .order('name_en', { ascending: true }),
          supabase
            .from('suppliers')
            .select('id,name_ar,name_en')
            .order('name_en', { ascending: true }),
          supabase
            .from('vat_periods')
            .select('id,period_start,period_end,output_vat,input_vat,net_payable,filing_status,filed_date,notes')
            .order('period_start', { ascending: false }),
          supabase
            .from('app_settings')
            .select('key,value')
            .in('key', ['vat_filing_frequency', 'vat_rate']),
        ])

        const errs = [
          clientRes.error,
          supplierRes.error,
          projectsRes.error,
          suppliersRes.error,
          periodsRes.error,
          settingsRes.error,
        ].filter(Boolean)
        if (errs.length) throw errs[0]
        if (!active) return

        setClientInvoices(clientRes.data || [])
        setSupplierInvoices(supplierRes.data || [])
        setProjects(projectsRes.data || [])
        setSuppliers(suppliersRes.data || [])
        setVatPeriods(periodsRes.data || [])

        const settings = Object.fromEntries((settingsRes.data || []).map((row) => [row.key, row.value]))
        const nextFrequency = settings.vat_filing_frequency === 'quarterly' ? 'quarterly' : 'monthly'
        setFrequency(nextFrequency)
        setPeriodMode(nextFrequency)
        setVatRate(toNum(settings.vat_rate) || 0.15)
      } catch (err) {
        if (!active) return
        setError(err?.message || 'Failed to load VAT data')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [refreshTick])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  }), [lang])

  const monthOptions = useMemo(() => {
    const keys = new Set()
    for (const row of clientInvoices) {
      if (!row.invoice_date) continue
      const d = new Date(row.invoice_date)
      if (!Number.isFinite(d.getTime())) continue
      const m = String(d.getMonth() + 1).padStart(2, '0')
      keys.add(`${d.getFullYear()}-${m}`)
    }
    for (const row of supplierInvoices) {
      if (!row.invoice_date) continue
      const d = new Date(row.invoice_date)
      if (!Number.isFinite(d.getTime())) continue
      const m = String(d.getMonth() + 1).padStart(2, '0')
      keys.add(`${d.getFullYear()}-${m}`)
    }
    keys.add(getCurrentMonthKey())
    return Array.from(keys).sort().reverse()
  }, [clientInvoices, supplierInvoices])

  const quarterOptions = useMemo(() => {
    const keys = new Set()
    const collect = (value) => {
      const d = new Date(value)
      if (!Number.isFinite(d.getTime())) return
      const q = Math.floor(d.getMonth() / 3) + 1
      keys.add(`${d.getFullYear()}-Q${q}`)
    }
    for (const row of clientInvoices) collect(row.invoice_date)
    for (const row of supplierInvoices) collect(row.invoice_date)
    keys.add(getCurrentQuarterKey())
    return Array.from(keys).sort().reverse()
  }, [clientInvoices, supplierInvoices])

  const periodRange = useMemo(() => {
    if (periodMode === 'monthly') return monthRange(selectedMonth)
    if (periodMode === 'quarterly') return quarterRange(selectedQuarter)
    if (!customStart || !customEnd) return { start: '', end: '' }
    return customStart <= customEnd
      ? { start: customStart, end: customEnd }
      : { start: customEnd, end: customStart }
  }, [periodMode, selectedMonth, selectedQuarter, customStart, customEnd])

  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers])

  const vat = useMemo(() => calcVatForPeriod(
    clientInvoices,
    supplierInvoices,
    periodRange.start,
    periodRange.end,
  ), [clientInvoices, supplierInvoices, periodRange.start, periodRange.end])

  const earliestInvoiceDate = useMemo(() => {
    const dates = [...clientInvoices, ...supplierInvoices]
      .map((row) => row.invoice_date)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b)
    if (!dates.length) return null
    return new Date(dates[0])
  }, [clientInvoices, supplierInvoices])

  const amountToRemit = vat.net_vat
  const remitClass = amountToRemit > 0 ? 'vat-remit-payable' : 'vat-remit-credit'

  const fmtMoney = (value) => `${money.format(toNum(value))} SAR`
  const fmtDate = (value) => {
    if (!value) return '-'
    const d = new Date(value)
    if (!Number.isFinite(d.getTime())) return value
    return dateFmt.format(d)
  }

  const invoiceLabel = (row) => row.invoice_no || row.invoice_number || row.id

  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

  const onSaveCurrentPeriod = async () => {
    if (!isAdmin) return
    if (!periodRange.start || !periodRange.end) {
      setError(lang === 'ar' ? 'اختر فترة صحيحة أولًا.' : 'Select a valid period first.')
      return
    }

    setSaveState('saving')
    setError('')

    const payload = {
      period_start: periodRange.start,
      period_end: periodRange.end,
      output_vat: vat.output_vat,
      input_vat: vat.input_vat,
      net_payable: vat.net_vat,
      filing_status: 'draft',
    }

    try {
      const existing = await supabase
        .from('vat_periods')
        .select('id,filing_status,filed_date,notes')
        .eq('period_start', periodRange.start)
        .eq('period_end', periodRange.end)
        .maybeSingle()

      if (existing.error) throw existing.error

      if (existing.data?.id) {
        const { error: updateError } = await supabase
          .from('vat_periods')
          .update({
            ...payload,
            filing_status: existing.data.filing_status || 'draft',
            filed_date: existing.data.filed_date || null,
            notes: existing.data.notes || null,
          })
          .eq('id', existing.data.id)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase.from('vat_periods').insert(payload)
        if (insertError) throw insertError
      }

      setSaveState('saved')
      setRefreshTick((v) => v + 1)
    } catch (err) {
      setSaveState('retry')
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ الفترة.' : 'Failed to save period.'))
    }
  }

  const flushPeriodField = async (rowId, field) => {
    const key = `${rowId}:${field}`
    const value = pendingRef.current[key]
    if (value === undefined) return
    try {
      const { error: updateError } = await supabase.from('vat_periods').update({ [field]: value || null }).eq('id', rowId)
      if (updateError) throw updateError
      setRowStatus((prev) => ({ ...prev, [key]: 'saved' }))
    } catch (err) {
      setRowStatus((prev) => ({ ...prev, [key]: 'retry' }))
      setError(err?.message || (lang === 'ar' ? 'تعذر تحديث السجل.' : 'Failed to update record.'))
    } finally {
      delete pendingRef.current[key]
    }
  }

  const onPeriodFieldChange = (rowId, field, value) => {
    if (!isAdmin) return
    const key = `${rowId}:${field}`
    setVatPeriods((prev) => prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)))
    pendingRef.current[key] = value
    setRowStatus((prev) => ({ ...prev, [key]: 'saving' }))
    if (timersRef.current[key]) clearTimeout(timersRef.current[key])
    timersRef.current[key] = setTimeout(() => flushPeriodField(rowId, field), DEBOUNCE_MS)
  }

  const rowStatusText = (value) => {
    if (value === 'saving') return lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'
    if (value === 'saved') return lang === 'ar' ? 'تم ✓' : 'Saved ✓'
    if (value === 'retry') return lang === 'ar' ? 'إعادة المحاولة' : 'Retry'
    return ''
  }

  const exportCsv = () => {
    const rows = []
    rows.push(['Section', 'Invoice No', 'Date', 'Name', 'Amount Net', 'VAT Amount', 'Valid Tax Invoice'])

    for (const row of vat.outputRows) {
      rows.push([
        'Output VAT',
        invoiceLabel(row),
        row.invoice_date || '',
        formatProjectName(projectById[row.project_id], lang),
        toNum(row.amount_net).toFixed(2),
        toNum(row.vat_amount).toFixed(2),
        'n/a',
      ])
    }

    for (const row of vat.inputRows) {
      rows.push([
        'Input VAT (Eligible)',
        invoiceLabel(row),
        row.invoice_date || '',
        formatEmployeeName(supplierById[row.supplier_id], lang),
        toNum(row.amount_net).toFixed(2),
        toNum(row.vat_amount).toFixed(2),
        'true',
      ])
    }

    for (const row of vat.excludedInputRows) {
      rows.push([
        'Input VAT (Excluded)',
        invoiceLabel(row),
        row.invoice_date || '',
        formatEmployeeName(supplierById[row.supplier_id], lang),
        toNum(row.amount_net).toFixed(2),
        toNum(row.vat_amount).toFixed(2),
        'false',
      ])
    }

    rows.push([])
    rows.push(['Totals', '', '', '', '', '', ''])
    rows.push(['Output VAT', '', '', '', '', toNum(vat.output_vat).toFixed(2), ''])
    rows.push(['Input VAT (Eligible)', '', '', '', '', toNum(vat.input_vat).toFixed(2), ''])
    rows.push(['Input VAT Excluded', '', '', '', '', toNum(vat.excluded_input_vat).toFixed(2), ''])
    rows.push(['Net VAT', '', '', '', '', toNum(vat.net_vat).toFixed(2), ''])

    const csv = buildCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const rangeLabel = `${periodRange.start || 'start'}_${periodRange.end || 'end'}`
    anchor.href = url
    anchor.download = `vat-working-paper-${rangeLabel}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <CardTitle>{lang === 'ar' ? 'تحميل ضريبة القيمة المضافة...' : 'Loading VAT...'}</CardTitle>
        </Card>
      </div>
    )
  }

  const outputRows = vat.outputRows.length
    ? vat.outputRows.map((row) => ({
      id: row.id,
      invoice_no: invoiceLabel(row),
      date: fmtDate(row.invoice_date),
      name: formatProjectName(projectById[row.project_id], lang),
      amount_net: fmtMoney(row.amount_net),
      vat: fmtMoney(row.vat_amount),
    }))
    : [{ id: 'empty-output', invoice_no: '-', date: '-', name: lang === 'ar' ? 'لا توجد بيانات' : 'No data', amount_net: '-', vat: '-' }]

  const inputRows = vat.inputRows.length
    ? vat.inputRows.map((row) => ({
      id: row.id,
      invoice_no: invoiceLabel(row),
      date: fmtDate(row.invoice_date),
      name: formatEmployeeName(supplierById[row.supplier_id], lang),
      amount_net: fmtMoney(row.amount_net),
      vat: fmtMoney(row.vat_amount),
    }))
    : [{ id: 'empty-input', invoice_no: '-', date: '-', name: lang === 'ar' ? 'لا توجد بيانات' : 'No data', amount_net: '-', vat: '-' }]

  const excludedRows = vat.excludedInputRows.length
    ? vat.excludedInputRows.map((row) => ({
      id: row.id,
      invoice_no: invoiceLabel(row),
      date: fmtDate(row.invoice_date),
      name: formatEmployeeName(supplierById[row.supplier_id], lang),
      amount_net: fmtMoney(row.amount_net),
      vat: fmtMoney(row.vat_amount),
    }))
    : [{ id: 'empty-excluded', invoice_no: '-', date: '-', name: lang === 'ar' ? 'لا توجد بيانات' : 'No data', amount_net: '-', vat: '-' }]

  const periodRows = vatPeriods.length
    ? vatPeriods.map((row) => {
      const statusKey = `${row.id}:filing_status`
      const dateKey = `${row.id}:filed_date`
      return {
        id: row.id || `${row.period_start}-${row.period_end}`,
        period: `${row.period_start} -> ${row.period_end}`,
        output: fmtMoney(row.output_vat),
        input: fmtMoney(row.input_vat),
        net: toNum(row.net_payable),
        netLabel: fmtMoney(row.net_payable),
        filing_status: row.filing_status || 'draft',
        filed_date: row.filed_date,
        statusKey,
        dateKey,
      }
    })
    : [{ id: 'empty-periods', period: '-', output: '-', input: '-', net: 0, netLabel: '-', filing_status: 'draft', filed_date: null, empty: true }]

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={lang === 'ar' ? 'ضريبة القيمة المضافة (VAT)' : 'VAT'}
        dateText={todayLabel}
        subtitle={lang === 'ar' ? 'متابعة إقرار الضريبة حسب الفترات - عرض بصري فقط.' : 'Period-based VAT reporting workspace.'}
      />

      <Card className="mb-4 border-amber-200 bg-amber-50">
        <div className="text-sm font-semibold text-amber-800">
          {lang === 'ar'
            ? `تم تحميل أرصدة تاريخية للموردين دون تفصيل VAT، لذلك فإن Input VAT قبل ${earliestInvoiceDate ? fmtDate(earliestInvoiceDate) : '-'} تقريبي. يرجى تأكيد دورية الإقرار والأرقام مع الزكاة/محاسبك.`
            : `Historical opening-balance supplier payables were loaded with VAT not itemised, so input VAT before ${earliestInvoiceDate ? fmtDate(earliestInvoiceDate) : '-'} is approximate. Confirm filing frequency and figures with ZATCA / your accountant.`}
        </div>
      </Card>

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardTitle>{lang === 'ar' ? 'اختيار الفترة' : 'Period Selector'}</CardTitle>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'الدورية الافتراضية من الإعدادات' : 'Default from settings'}</div>
            <div className="ds-money mt-1 text-sm">{frequency}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'معدل VAT' : 'VAT rate'}</div>
            <div className="ds-money mt-1 text-sm">{(vatRate * 100).toFixed(2)}%</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'نوع الفترة' : 'Period type'}</div>
            <select className="mt-1 h-10 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm" value={periodMode} onChange={(e) => setPeriodMode(e.target.value)}>
              <option value="monthly">{lang === 'ar' ? 'شهري' : 'Monthly'}</option>
              <option value="quarterly">{lang === 'ar' ? 'ربع سنوي' : 'Quarterly'}</option>
              <option value="custom">{lang === 'ar' ? 'نطاق مخصص' : 'Custom range'}</option>
            </select>
          </div>

          {periodMode === 'monthly' ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'اختر الشهر' : 'Pick month'}</div>
              <select className="mt-1 h-10 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                {monthOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          ) : periodMode === 'quarterly' ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'اختر الربع' : 'Pick quarter'}</div>
              <select className="mt-1 h-10 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm" value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
                {quarterOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'من' : 'From'}</div>
                <input className="mt-1 h-10 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ds-muted)]">{lang === 'ar' ? 'إلى' : 'To'}</div>
                <input className="mt-1 h-10 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 text-sm text-[var(--ds-muted)]">
          {lang === 'ar' ? 'الفترة المختارة:' : 'Selected period:'} <span className="ds-money">{periodRange.start || '-'} {'->'} {periodRange.end || '-'}</span>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Output VAT" value={fmtMoney(vat.output_vat)} note={lang === 'ar' ? 'VAT المحصل على فواتير العملاء' : 'VAT charged to clients'} />
        <KpiCard label="Input VAT" value={fmtMoney(vat.input_vat)} note={lang === 'ar' ? 'VAT القابل للخصم (فواتير ضريبية صحيحة)' : 'Recoverable VAT with valid tax invoices'} tone="positive" />
        <KpiCard
          label={lang === 'ar' ? 'صافي VAT' : 'Net VAT'}
          value={fmtMoney(vat.net_vat)}
          tone={vat.net_vat > 0 ? 'danger' : 'positive'}
          note={vat.net_vat >= 0
            ? (lang === 'ar' ? 'المبلغ المستحق سداده للزكاة (ZATCA)' : 'Amount to remit to ZATCA')
            : (lang === 'ar' ? 'رصيد دائن/استرداد مرحل' : 'Credit/refund carried forward')}
        />
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{lang === 'ar' ? 'تفصيل الفترة' : 'Period Breakdown'}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              {lang === 'ar' ? 'تصدير CSV' : 'Export CSV'}
            </Button>
            {isAdmin ? (
              <Button size="sm" onClick={onSaveCurrentPeriod}>
                {saveState === 'saving'
                  ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : (lang === 'ar' ? 'حفظ الفترة الحالية' : 'Save current period')}
              </Button>
            ) : (
              <span className="text-xs text-[var(--ds-muted)]">{lang === 'ar' ? 'عرض فقط' : 'Read-only'}</span>
            )}
          </div>
        </div>

        <div className="mt-3 text-sm font-semibold text-[var(--ds-text)]">{lang === 'ar' ? 'Output VAT (العملاء)' : 'Output VAT (Clients)'}</div>
        <DataTable
          className="mt-2"
          columns={[
            { key: 'invoice_no', label: lang === 'ar' ? 'رقم الفاتورة' : 'No' },
            { key: 'date', label: lang === 'ar' ? 'التاريخ' : 'Date' },
            { key: 'name', label: lang === 'ar' ? 'المشروع' : 'Project' },
            { key: 'amount_net', label: lang === 'ar' ? 'صافي' : 'Net', render: (row) => <span className="ds-money">{row.amount_net}</span> },
            { key: 'vat', label: 'VAT', render: (row) => <span className="ds-money">{row.vat}</span> },
          ]}
          rows={outputRows}
        />

        <div className="mt-4 text-sm font-semibold text-[var(--ds-text)]">{lang === 'ar' ? 'Input VAT (الموردون - مؤهل)' : 'Input VAT (Suppliers - Eligible)'}</div>
        <DataTable
          className="mt-2"
          columns={[
            { key: 'invoice_no', label: lang === 'ar' ? 'رقم الفاتورة' : 'No' },
            { key: 'date', label: lang === 'ar' ? 'التاريخ' : 'Date' },
            { key: 'name', label: lang === 'ar' ? 'المورد' : 'Supplier' },
            { key: 'amount_net', label: lang === 'ar' ? 'صافي' : 'Net', render: (row) => <span className="ds-money">{row.amount_net}</span> },
            { key: 'vat', label: 'VAT', render: (row) => <span className="ds-money">{row.vat}</span> },
          ]}
          rows={inputRows}
        />

        <div className="mt-4 text-sm font-semibold text-[var(--ds-text)]">{lang === 'ar' ? 'فواتير موردين مستبعدة (بدون مستند ضريبي صحيح)' : 'Excluded Supplier Invoices (no valid tax invoice)'}</div>
        <DataTable
          className="mt-2"
          columns={[
            { key: 'invoice_no', label: lang === 'ar' ? 'رقم الفاتورة' : 'No' },
            { key: 'date', label: lang === 'ar' ? 'التاريخ' : 'Date' },
            { key: 'name', label: lang === 'ar' ? 'المورد' : 'Supplier' },
            { key: 'amount_net', label: lang === 'ar' ? 'صافي' : 'Net', render: (row) => <span className="ds-money">{row.amount_net}</span> },
            { key: 'vat', label: lang === 'ar' ? 'VAT مفقود' : 'Missed VAT', render: (row) => <span className="ds-money">{row.vat}</span> },
          ]}
          rows={excludedRows}
        />

        <div className="mt-2 text-right text-sm text-[var(--ds-muted)]">
          <span className="ds-money">{lang === 'ar' ? 'إجمالي VAT المستبعد: ' : 'Excluded VAT subtotal: '}{fmtMoney(vat.excluded_input_vat)}</span>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>{lang === 'ar' ? 'سجل فترات VAT' : 'VAT Periods Running Table'}</CardTitle>
        <DataTable
          className="mt-3"
          columns={[
            { key: 'period', label: lang === 'ar' ? 'الفترة' : 'Period', render: (row) => <span className="ds-money">{row.period}</span> },
            { key: 'output', label: 'Output', render: (row) => <span className="ds-money">{row.output}</span> },
            { key: 'input', label: 'Input', render: (row) => <span className="ds-money">{row.input}</span> },
            {
              key: 'netLabel',
              label: 'Net',
              render: (row) => <span className={`ds-money ${row.net >= 0 ? 'text-[var(--ds-danger)]' : 'text-[var(--ds-positive)]'}`}>{row.netLabel}</span>,
            },
            {
              key: 'filing_status',
              label: lang === 'ar' ? 'حالة الإقرار' : 'Filing Status',
              render: (row) => {
                if (row.empty) return '-'
                return isAdmin ? (
                  <div className="flex flex-col gap-1">
                    <select
                      className="h-9 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2 text-xs"
                      value={row.filing_status}
                      onChange={(e) => onPeriodFieldChange(row.id, 'filing_status', e.target.value)}
                    >
                      {PERIOD_STATUS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    {rowStatus[row.statusKey] ? <span className="text-[11px] text-[var(--ds-muted)]">{rowStatusText(rowStatus[row.statusKey])}</span> : null}
                  </div>
                ) : <StatusPill status={row.filing_status} lang={lang} />
              },
            },
            {
              key: 'filed_date',
              label: lang === 'ar' ? 'تاريخ التقديم' : 'Filed Date',
              render: (row) => {
                if (row.empty) return '-'
                return isAdmin ? (
                  <div className="flex flex-col gap-1">
                    <input
                      className="h-9 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2 text-xs"
                      type="date"
                      value={row.filed_date || ''}
                      onChange={(e) => onPeriodFieldChange(row.id, 'filed_date', e.target.value)}
                    />
                    {rowStatus[row.dateKey] ? <span className="text-[11px] text-[var(--ds-muted)]">{rowStatusText(rowStatus[row.dateKey])}</span> : null}
                  </div>
                ) : fmtDate(row.filed_date)
              },
            },
          ]}
          rows={periodRows}
        />
      </Card>
    </div>
  )
}
