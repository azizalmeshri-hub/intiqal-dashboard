import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { calcVatForPeriod } from '../lib/calc'
import { formatEmployeeName, formatProjectName } from '../lib/employees'

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
    return <div className="card"><div className="card-label">{lang === 'ar' ? 'تحميل ضريبة القيمة المضافة...' : 'Loading VAT...'}</div></div>
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'ضريبة القيمة المضافة (VAT)' : 'VAT'}</h1>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="tag-note" style={{ display: 'block', lineHeight: 1.5 }}>
          {lang === 'ar'
            ? `تم تحميل أرصدة تاريخية للموردين دون تفصيل VAT، لذلك فإن Input VAT قبل ${earliestInvoiceDate ? fmtDate(earliestInvoiceDate) : '-'} تقريبي. يرجى تأكيد دورية الإقرار والأرقام مع الزكاة/محاسبك.`
            : `Historical opening-balance supplier payables were loaded with VAT not itemised, so input VAT before ${earliestInvoiceDate ? fmtDate(earliestInvoiceDate) : '-'} is approximate. Confirm filing frequency and figures with ZATCA / your accountant.`}
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'اختيار الفترة' : 'Period Selector'}</div>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div>
            <div className="card-label">{lang === 'ar' ? 'الدورية الافتراضية من الإعدادات' : 'Default from settings'}</div>
            <div className="mono">{frequency}</div>
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'معدل VAT' : 'VAT rate'}</div>
            <div className="mono">{(vatRate * 100).toFixed(2)}%</div>
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 8 }}>
          <div>
            <div className="card-label">{lang === 'ar' ? 'نوع الفترة' : 'Period type'}</div>
            <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value)}>
              <option value="monthly">{lang === 'ar' ? 'شهري' : 'Monthly'}</option>
              <option value="quarterly">{lang === 'ar' ? 'ربع سنوي' : 'Quarterly'}</option>
              <option value="custom">{lang === 'ar' ? 'نطاق مخصص' : 'Custom range'}</option>
            </select>
          </div>

          {periodMode === 'monthly' ? (
            <div>
              <div className="card-label">{lang === 'ar' ? 'اختر الشهر' : 'Pick month'}</div>
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                {monthOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          ) : periodMode === 'quarterly' ? (
            <div>
              <div className="card-label">{lang === 'ar' ? 'اختر الربع' : 'Pick quarter'}</div>
              <select value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
                {quarterOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-grid" style={{ margin: 0 }}>
              <div>
                <div className="card-label">{lang === 'ar' ? 'من' : 'From'}</div>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </div>
              <div>
                <div className="card-label">{lang === 'ar' ? 'إلى' : 'To'}</div>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="card-sub" style={{ marginTop: 8 }}>
          {lang === 'ar' ? 'الفترة المختارة:' : 'Selected period:'} <span className="mono">{periodRange.start || '-'} → {periodRange.end || '-'}</span>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'Output VAT' : 'Output VAT'}</div>
          <div className="card-value mono">{fmtMoney(vat.output_vat)}</div>
          <div className="card-sub">{lang === 'ar' ? 'VAT المحصل على فواتير العملاء' : 'VAT charged to clients'}</div>
        </div>

        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'Input VAT' : 'Input VAT'}</div>
          <div className="card-value mono">{fmtMoney(vat.input_vat)}</div>
          <div className="card-sub">{lang === 'ar' ? 'VAT القابل للخصم (فواتير ضريبية صحيحة)' : 'Recoverable VAT with valid tax invoices'}</div>
        </div>

        <div className={`card ${remitClass}`}>
          <div className="card-label">{lang === 'ar' ? 'صافي VAT' : 'Net VAT'}</div>
          <div className="card-value mono">{fmtMoney(vat.net_vat)}</div>
          <div className="card-sub">
            {vat.net_vat >= 0
              ? (lang === 'ar' ? 'المبلغ المستحق سداده للزكاة (ZATCA)' : 'Amount to remit to ZATCA')
              : (lang === 'ar' ? 'رصيد دائن/استرداد مرحل' : 'Credit/refund carried forward')}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="section-title" style={{ margin: 0 }}>{lang === 'ar' ? 'تفصيل الفترة' : 'Period Breakdown'}</div>
          <div className="employee-actions">
            <button className="btn secondary" onClick={exportCsv}>
              {lang === 'ar' ? 'تصدير CSV' : 'Export CSV'}
            </button>
            {isAdmin ? (
              <button className="btn" onClick={onSaveCurrentPeriod}>
                {saveState === 'saving'
                  ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : (lang === 'ar' ? 'حفظ الفترة الحالية' : 'Save current period')}
              </button>
            ) : (
              <span className="card-sub">{lang === 'ar' ? 'عرض فقط' : 'Read-only'}</span>
            )}
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>{lang === 'ar' ? 'Output VAT (العملاء)' : 'Output VAT (Clients)'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'رقم الفاتورة' : 'No'}</th>
                <th>{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                <th>{lang === 'ar' ? 'صافي' : 'Net'}</th>
                <th>{lang === 'ar' ? 'VAT' : 'VAT'}</th>
              </tr>
            </thead>
            <tbody>
              {vat.outputRows.length ? vat.outputRows.map((row) => (
                <tr key={row.id}>
                  <td>{invoiceLabel(row)}</td>
                  <td>{fmtDate(row.invoice_date)}</td>
                  <td>{formatProjectName(projectById[row.project_id], lang)}</td>
                  <td className="num mono">{fmtMoney(row.amount_net)}</td>
                  <td className="num mono">{fmtMoney(row.vat_amount)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="card-sub">{lang === 'ar' ? 'لا توجد فواتير عملاء في هذه الفترة.' : 'No client invoices in this period.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>{lang === 'ar' ? 'Input VAT (الموردون - مؤهل)' : 'Input VAT (Suppliers - Eligible)'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'رقم الفاتورة' : 'No'}</th>
                <th>{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th>{lang === 'ar' ? 'المورد' : 'Supplier'}</th>
                <th>{lang === 'ar' ? 'صافي' : 'Net'}</th>
                <th>{lang === 'ar' ? 'VAT' : 'VAT'}</th>
              </tr>
            </thead>
            <tbody>
              {vat.inputRows.length ? vat.inputRows.map((row) => (
                <tr key={row.id}>
                  <td>{invoiceLabel(row)}</td>
                  <td>{fmtDate(row.invoice_date)}</td>
                  <td>{formatEmployeeName(supplierById[row.supplier_id], lang)}</td>
                  <td className="num mono">{fmtMoney(row.amount_net)}</td>
                  <td className="num mono">{fmtMoney(row.vat_amount)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="card-sub">{lang === 'ar' ? 'لا توجد فواتير موردين مؤهلة في هذه الفترة.' : 'No eligible supplier invoices in this period.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="section-title" style={{ marginTop: 18 }}>{lang === 'ar' ? 'فواتير موردين مستبعدة (بدون مستند ضريبي صحيح)' : 'Excluded Supplier Invoices (no valid tax invoice)'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'رقم الفاتورة' : 'No'}</th>
                <th>{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th>{lang === 'ar' ? 'المورد' : 'Supplier'}</th>
                <th>{lang === 'ar' ? 'صافي' : 'Net'}</th>
                <th>{lang === 'ar' ? 'VAT مفقود' : 'Missed VAT'}</th>
              </tr>
            </thead>
            <tbody>
              {vat.excludedInputRows.length ? vat.excludedInputRows.map((row) => (
                <tr key={row.id}>
                  <td>{invoiceLabel(row)}</td>
                  <td>{fmtDate(row.invoice_date)}</td>
                  <td>{formatEmployeeName(supplierById[row.supplier_id], lang)}</td>
                  <td className="num mono">{fmtMoney(row.amount_net)}</td>
                  <td className="num mono">{fmtMoney(row.vat_amount)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="card-sub">{lang === 'ar' ? 'لا توجد فواتير مستبعدة في هذه الفترة.' : 'No excluded supplier invoices in this period.'}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="num mono">{lang === 'ar' ? 'إجمالي VAT المستبعد' : 'Excluded VAT subtotal'}</td>
                <td className="num mono">{fmtMoney(vat.excluded_input_vat)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'سجل فترات VAT' : 'VAT Periods Running Table'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'الفترة' : 'Period'}</th>
                <th>{lang === 'ar' ? 'Output' : 'Output'}</th>
                <th>{lang === 'ar' ? 'Input' : 'Input'}</th>
                <th>{lang === 'ar' ? 'Net' : 'Net'}</th>
                <th>{lang === 'ar' ? 'حالة الإقرار' : 'Filing Status'}</th>
                <th>{lang === 'ar' ? 'تاريخ التقديم' : 'Filed Date'}</th>
              </tr>
            </thead>
            <tbody>
              {vatPeriods.length ? vatPeriods.map((row) => {
                const statusKey = `${row.id}:filing_status`
                const dateKey = `${row.id}:filed_date`
                return (
                  <tr key={row.id || `${row.period_start}-${row.period_end}`}>
                    <td className="mono">{row.period_start} → {row.period_end}</td>
                    <td className="num mono">{fmtMoney(row.output_vat)}</td>
                    <td className="num mono">{fmtMoney(row.input_vat)}</td>
                    <td className={`num mono ${toNum(row.net_payable) >= 0 ? 'neg' : 'pos'}`}>{fmtMoney(row.net_payable)}</td>
                    <td>
                      {isAdmin ? (
                        <div className="cell-edit-wrap">
                          <select value={row.filing_status || 'draft'} onChange={(e) => onPeriodFieldChange(row.id, 'filing_status', e.target.value)}>
                            {PERIOD_STATUS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                          {rowStatus[statusKey] ? <span className="save-pill">{rowStatusText(rowStatus[statusKey])}</span> : null}
                        </div>
                      ) : (row.filing_status || 'draft')}
                    </td>
                    <td>
                      {isAdmin ? (
                        <div className="cell-edit-wrap">
                          <input type="date" value={row.filed_date || ''} onChange={(e) => onPeriodFieldChange(row.id, 'filed_date', e.target.value)} />
                          {rowStatus[dateKey] ? <span className="save-pill">{rowStatusText(rowStatus[dateKey])}</span> : null}
                        </div>
                      ) : fmtDate(row.filed_date)}
                    </td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={6} className="card-sub">{lang === 'ar' ? 'لا توجد فترات محفوظة بعد.' : 'No saved VAT periods yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
