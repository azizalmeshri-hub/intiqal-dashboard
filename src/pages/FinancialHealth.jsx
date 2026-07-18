import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import KpiCard from '../components/ui/KpiCard'
import DataTable from '../components/ui/DataTable'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import {
  AGING_BUCKETS,
  buildOpenItems,
  calcAP,
  calcAR,
  calcAging,
  calcBacklog,
  calcCashFlowByMonth,
  calcCollectionRate,
  calcNetPosition,
  calcNextFourWeeks,
  calcProjectProfitability,
  calcRetentionReceivable,
  calcSupplierConcentration,
} from '../lib/calc'

const SANITY_TARGET = {
  ar: 1383877,
  ap: 4247865,
  net: -2863988,
}

const AGING_BUCKET_LABELS = {
  '0-30': { en: '0-30', ar: 'أقل من ٣٠' },
  '31-60': { en: '31-60', ar: '٣٠-٦٠' },
  '61-90': { en: '61-90', ar: '٦٠-٩٠' },
  '91-120': { en: '91-120', ar: '٩٠-١٢٠' },
  '121-180': { en: '121-180', ar: '١٢٠-١٨٠' },
  '>180': { en: '>180', ar: 'أكثر من ١٨٠' },
  'No due date': { en: 'No due date', ar: 'بدون تاريخ استحقاق' },
}

const toNum = (value) => {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

const pctDelta = (value, expected) => {
  if (!expected) return 0
  return Math.abs(value - expected) / Math.abs(expected)
}

export default function FinancialHealth() {
  const { lang } = useLang()
  const { role, isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [rows, setRows] = useState({
    projects: [],
    clientInvoices: [],
    clientPayments: [],
    supplierInvoices: [],
    supplierPayments: [],
    suppliers: [],
  })
  const [cashOnHand, setCashOnHand] = useState(0)
  const [cashInput, setCashInput] = useState('0')
  const [savingCash, setSavingCash] = useState(false)
  const [cashError, setCashError] = useState('')

  useEffect(() => {
    const onChanged = () => setRefreshTick((v) => v + 1)
    window.addEventListener('intiqal:data-changed', onChanged)
    return () => window.removeEventListener('intiqal:data-changed', onChanged)
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      setCashError('')

      try {
        const [
          projectsRes,
          clientInvRes,
          clientPayRes,
          supplierInvRes,
          supplierPayRes,
          suppliersRes,
          cashRes,
        ] = await Promise.all([
          supabase
            .from('projects')
            .select('id,name_ar,name_en,contract_value_net')
            .order('name_en', { ascending: true }),
          supabase
            .from('client_invoices')
            .select('id,project_id,due_date,amount_net,amount_gross,retention_amount,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('client_payments')
            .select('id,project_id,client_invoice_id,payment_date,amount,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('supplier_invoices')
            .select('id,supplier_id,project_id,due_date,amount_net,amount_gross,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('supplier_payments')
            .select('id,supplier_invoice_id,payment_date,amount,deleted_at')
            .is('deleted_at', null),
          supabase
            .from('suppliers')
            .select('id,name_ar,name_en')
            .order('name_en', { ascending: true }),
          supabase
            .from('app_settings')
            .select('key,value')
            .eq('key', 'cash_on_hand')
            .maybeSingle(),
        ])

        const errors = [
          projectsRes.error,
          clientInvRes.error,
          clientPayRes.error,
          supplierInvRes.error,
          supplierPayRes.error,
        ].filter(Boolean)

        if (errors.length) throw errors[0]

        if (!active) return

        const nextRows = {
          projects: projectsRes.data || [],
          clientInvoices: clientInvRes.data || [],
          clientPayments: clientPayRes.data || [],
          supplierInvoices: supplierInvRes.data || [],
          supplierPayments: supplierPayRes.data || [],
          suppliers: suppliersRes.error ? [] : (suppliersRes.data || []),
        }

        setRows(nextRows)

        const cashValue = cashRes.error ? 0 : toNum(cashRes.data?.value)
        setCashOnHand(cashValue)
        setCashInput(String(cashValue))

        if (cashRes.error) {
          setCashError(lang === 'ar' ? 'تعذر تحميل الرصيد النقدي من app_settings' : 'Failed to load cash_on_hand from app_settings')
        }
      } catch (err) {
        if (!active) return
        console.error('Financial health load failed:', err)
        setError(err?.message || 'Failed to load financial data')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [refreshTick, lang])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const percent = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }), [])

  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

  const projectNameById = useMemo(() => {
    const map = {}
    for (const p of rows.projects) {
      map[p.id] = lang === 'ar' ? (p.name_ar || p.name_en || p.id) : (p.name_en || p.name_ar || p.id)
    }
    return map
  }, [rows.projects, lang])

  const supplierNameById = useMemo(() => {
    const map = {}
    for (const s of rows.suppliers) {
      map[s.id] = lang === 'ar' ? (s.name_ar || s.name_en || s.id) : (s.name_en || s.name_ar || s.id)
    }
    return map
  }, [rows.suppliers, lang])

  const openARItems = useMemo(() => buildOpenItems({
    invoices: rows.clientInvoices,
    payments: rows.clientPayments,
    invoiceAmountKey: 'amount_gross',
    invoiceIdKey: 'id',
    paymentInvoiceIdKey: 'client_invoice_id',
    dueDateKey: 'due_date',
  }), [rows.clientInvoices, rows.clientPayments])

  const openAPItems = useMemo(() => buildOpenItems({
    invoices: rows.supplierInvoices,
    payments: rows.supplierPayments,
    invoiceAmountKey: 'amount_gross',
    invoiceIdKey: 'id',
    paymentInvoiceIdKey: 'supplier_invoice_id',
    dueDateKey: 'due_date',
  }), [rows.supplierInvoices, rows.supplierPayments])

  const ar = useMemo(() => calcAR(rows.clientInvoices, rows.clientPayments), [rows.clientInvoices, rows.clientPayments])
  const ap = useMemo(() => calcAP(rows.supplierInvoices, rows.supplierPayments), [rows.supplierInvoices, rows.supplierPayments])
  const retentionReceivable = useMemo(() => calcRetentionReceivable(rows.clientInvoices), [rows.clientInvoices])
  const netPosition = useMemo(() => calcNetPosition(ar, ap), [ar, ap])
  const collectionRate = useMemo(() => calcCollectionRate(rows.clientInvoices, rows.clientPayments), [rows.clientInvoices, rows.clientPayments])

  const backlog = useMemo(() => calcBacklog(rows.projects, rows.clientInvoices), [rows.projects, rows.clientInvoices])

  const arAging = useMemo(() => calcAging(openARItems), [openARItems])
  const apAging = useMemo(() => calcAging(openAPItems), [openAPItems])

  const agingChart = useMemo(() => AGING_BUCKETS.map((bucket) => ({
    bucket,
    bucketLabel: lang === 'ar' ? AGING_BUCKET_LABELS[bucket]?.ar || bucket : AGING_BUCKET_LABELS[bucket]?.en || bucket,
    ar: arAging.rows.find((r) => r.bucket === bucket)?.amount || 0,
    ap: apAging.rows.find((r) => r.bucket === bucket)?.amount || 0,
  })), [arAging.rows, apAging.rows, lang])

  const cashFlow = useMemo(() => calcCashFlowByMonth(rows.clientPayments, rows.supplierPayments), [rows.clientPayments, rows.supplierPayments])

  const supplierConcentration = useMemo(() => {
    const top = calcSupplierConcentration(openAPItems, supplierNameById, 5)
    return top.map((row) => ({ ...row, displayName: row.name || row.supplier_id }))
  }, [openAPItems, supplierNameById])

  const profitability = useMemo(() => calcProjectProfitability(rows.projects, rows.clientInvoices, rows.supplierInvoices), [rows.projects, rows.clientInvoices, rows.supplierInvoices])

  const expectedAr4w = useMemo(() => calcNextFourWeeks(openARItems), [openARItems])
  const apDue4w = useMemo(() => calcNextFourWeeks(openAPItems), [openAPItems])
  const runway = cashOnHand + expectedAr4w - apDue4w

  const gap = Math.max(ap - ar, 0)

  const sanityMismatch = useMemo(() => {
    const far = (
      pctDelta(ar, SANITY_TARGET.ar) > 0.25 ||
      pctDelta(ap, SANITY_TARGET.ap) > 0.25 ||
      pctDelta(netPosition, SANITY_TARGET.net) > 0.25
    )

    if (!far) return ''

    return lang === 'ar'
      ? `تحذير المطابقة: AR=${money.format(ar)}، AP=${money.format(ap)}، Net=${money.format(netPosition)} وهي بعيدة عن المرجع المتفق عليه.`
      : `Sanity warning: AR=${money.format(ar)}, AP=${money.format(ap)}, Net=${money.format(netPosition)} are far from the expected baseline.`
  }, [ar, ap, netPosition, lang, money])

  const onSaveCash = async () => {
    if (!isAdmin) return

    setSavingCash(true)
    setCashError('')

    try {
      const value = toNum(cashInput)
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert({ key: 'cash_on_hand', value: value }, { onConflict: 'key' })

      if (upsertError) throw upsertError

      setCashOnHand(value)
    } catch (err) {
      setCashError(err?.message || (lang === 'ar' ? 'تعذر حفظ الرصيد النقدي' : 'Failed to save cash_on_hand'))
    } finally {
      setSavingCash(false)
    }
  }

  const fmtMoney = (value) => `${money.format(value)} SAR`

  const arAgingRows = useMemo(() => {
    const rowsOut = arAging.rows.map((row) => ({
      id: row.bucket,
      bucket: lang === 'ar' ? AGING_BUCKET_LABELS[row.bucket]?.ar || row.bucket : AGING_BUCKET_LABELS[row.bucket]?.en || row.bucket,
      amount: fmtMoney(row.amount),
    }))
    rowsOut.push({
      id: 'ar-total',
      bucket: lang === 'ar' ? 'الإجمالي' : 'Total',
      amount: fmtMoney(arAging.total),
      isTotal: true,
    })
    return rowsOut
  }, [arAging.rows, arAging.total, lang])

  const apAgingRows = useMemo(() => {
    const rowsOut = apAging.rows.map((row) => ({
      id: row.bucket,
      bucket: lang === 'ar' ? AGING_BUCKET_LABELS[row.bucket]?.ar || row.bucket : AGING_BUCKET_LABELS[row.bucket]?.en || row.bucket,
      amount: fmtMoney(row.amount),
    }))
    rowsOut.push({
      id: 'ap-total',
      bucket: lang === 'ar' ? 'الإجمالي' : 'Total',
      amount: fmtMoney(apAging.total),
      isTotal: true,
    })
    return rowsOut
  }, [apAging.rows, apAging.total, lang])

  const profitabilityRows = useMemo(() => profitability.map((row) => ({
    id: row.project_id,
    project: row.is_unallocated ? 'Unallocated' : (projectNameById[row.project_id] || row.project_id),
    billed_net: fmtMoney(row.billed_net),
    cost_to_date: fmtMoney(row.cost_to_date),
    gross_profit: row.gross_profit,
    gross_profit_label: fmtMoney(row.gross_profit),
    margin_pct: row.margin_pct == null ? '-' : `${percent.format(row.margin_pct)}%`,
  })), [profitability, projectNameById, percent])

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <CardTitle>{lang === 'ar' ? 'تحميل الصحة المالية...' : 'Loading financial health...'}</CardTitle>
        </Card>
      </div>
    )
  }

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={lang === 'ar' ? 'الصحة المالية' : 'Financial Health'}
        dateText={todayLabel}
        subtitle={lang === 'ar' ? 'مؤشرات السيولة والذمم والربحية - عرض بصري فقط.' : 'Liquidity, receivables, payables, and profitability at a glance.'}
      />

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      )}

      {sanityMismatch && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-sm font-semibold text-amber-800">{sanityMismatch}</div>
        </Card>
      )}

      {ap > ar && (
        <Card className="mb-4 border-amber-200 bg-[var(--ds-surface-soft)]">
          <div className="text-sm font-semibold text-amber-700">
            {lang === 'ar'
              ? `تنبيه: الالتزامات تتجاوز المستحقات بمقدار ${fmtMoney(gap)}`
              : `Alert: payables exceed receivables by ${fmtMoney(gap)}`}
          </div>
          <div className="mt-1 text-xs text-[var(--ds-muted)]">
            {lang === 'ar' ? 'نُدير حاليًا قائمة أولوية للمدفوعات.' : 'A payables priority queue is currently being managed.'}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label={lang === 'ar' ? 'النقد المتاح' : 'Cash On Hand'}
          value={fmtMoney(cashOnHand)}
          note={lang === 'ar' ? `تشغيل 4 أسابيع = ${fmtMoney(runway)}` : `4-week runway = ${fmtMoney(runway)}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              disabled={!isAdmin || savingCash}
              className="h-9 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm text-[var(--ds-text)] sm:w-[220px]"
            />
            {isAdmin
              ? (
                <Button variant="secondary" size="sm" disabled={savingCash} onClick={onSaveCash}>
                  {savingCash
                    ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                    : (lang === 'ar' ? 'حفظ' : 'Save')}
                </Button>
                )
              : <span className="text-xs text-[var(--ds-muted)]">{lang === 'ar' ? 'عرض فقط' : 'Read-only'}</span>}
          </div>
          {cashError ? <div className="mt-2 text-xs font-semibold text-[var(--ds-danger)]">{cashError}</div> : null}
        </KpiCard>

        <KpiCard label="AR" value={fmtMoney(ar)} note={lang === 'ar' ? 'الحسابات المدينة' : 'Accounts receivable'} tone="positive" />
        <KpiCard label="AP" value={fmtMoney(ap)} note={lang === 'ar' ? 'الحسابات الدائنة' : 'Accounts payable'} />
        <KpiCard label={lang === 'ar' ? 'الموقف الصافي' : 'Net Position'} value={fmtMoney(netPosition)} tone={netPosition < 0 ? 'danger' : 'positive'} trend={netPosition < 0 ? 'down' : 'up'} />
        <KpiCard label={lang === 'ar' ? 'استحقاق الاستقطاع' : 'Retention Receivable'} value={fmtMoney(retentionReceivable)} note={lang === 'ar' ? 'غير محصل بعد' : 'Not yet released'} />
        <KpiCard label={lang === 'ar' ? 'إجمالي الأعمال المتبقية' : 'Backlog Total'} value={fmtMoney(backlog.total)} note={lang === 'ar' ? `مشاريع بعقد غير معرف: ${backlog.unknownCount}` : `Projects with unknown contract: ${backlog.unknownCount}`} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <KpiCard label={lang === 'ar' ? 'نسبة التحصيل' : 'Collection Rate'} value={`${percent.format(collectionRate * 100)}%`} />
        <KpiCard label={lang === 'ar' ? 'AR متوقع خلال 4 أسابيع' : 'Expected AR Next 4 Weeks'} value={fmtMoney(expectedAr4w)} tone="positive" />
        <KpiCard label={lang === 'ar' ? 'AP مستحق خلال 4 أسابيع' : 'AP Due Next 4 Weeks'} value={fmtMoney(apDue4w)} tone="danger" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <DataTable
          columns={[
            { key: 'bucket', label: lang === 'ar' ? 'فئة AR' : 'AR Bucket' },
            { key: 'amount', label: lang === 'ar' ? 'المبلغ' : 'Amount', render: (row) => <span className={`ds-money ${row.isTotal ? 'font-bold' : ''}`}>{row.amount}</span> },
          ]}
          rows={arAgingRows}
        />
        <DataTable
          columns={[
            { key: 'bucket', label: lang === 'ar' ? 'فئة AP' : 'AP Bucket' },
            { key: 'amount', label: lang === 'ar' ? 'المبلغ' : 'Amount', render: (row) => <span className={`ds-money ${row.isTotal ? 'font-bold' : ''}`}>{row.amount}</span> },
          ]}
          rows={apAgingRows}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="h-[320px]">
          <CardTitle>{lang === 'ar' ? 'تقادم AR مقابل AP' : 'AR vs AP Aging'}</CardTitle>
          <div className="mt-3 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingChart} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8e3f1" />
                <XAxis dataKey="bucketLabel" stroke="#60748a" fontSize={11} interval={0} angle={lang === 'ar' ? 0 : -20} textAnchor={lang === 'ar' ? 'middle' : 'end'} height={50} />
                <YAxis stroke="#60748a" fontSize={11} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4ebf3', borderRadius: 10, fontSize: 12 }} formatter={(value) => [fmtMoney(value), '']} />
                <Legend />
                <Bar dataKey="ar" name="AR" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="ap" name="AP" fill="#93c5fd" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="h-[320px]">
          <CardTitle>{lang === 'ar' ? 'التدفقات النقدية الشهرية (داخل/خارج)' : 'Cash In vs Cash Out (Monthly)'}</CardTitle>
          <div className="mt-3 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cashFlow} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8e3f1" />
                <XAxis dataKey="month" stroke="#60748a" fontSize={11} />
                <YAxis stroke="#60748a" fontSize={11} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4ebf3', borderRadius: 10, fontSize: 12 }} formatter={(value) => [fmtMoney(value), '']} />
                <Legend />
                <Line type="monotone" dataKey="cashIn" name={lang === 'ar' ? 'داخل' : 'Cash In'} stroke="#0f9a6c" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="cashOut" name={lang === 'ar' ? 'خارج' : 'Cash Out'} stroke="#dc3f57" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4 h-[360px]">
        <CardTitle>{lang === 'ar' ? 'تركيز الموردين (Pareto)' : 'Supplier Concentration (Pareto)'}</CardTitle>
        <div className="mt-3 h-[290px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={supplierConcentration} layout="vertical" margin={{ top: 14, right: 12, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8e3f1" />
              <XAxis type="number" stroke="#60748a" fontSize={11} />
              <YAxis type="category" dataKey="displayName" stroke="#60748a" fontSize={11} width={150} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4ebf3', borderRadius: 10, fontSize: 12 }} formatter={(value) => [fmtMoney(value), lang === 'ar' ? 'مستحق' : 'Outstanding AP']} />
              <Bar dataKey="amount" name={lang === 'ar' ? 'AP المفتوح' : 'Outstanding AP'} radius={[0, 6, 6, 0]}>
                {supplierConcentration.map((row, idx) => {
                  const shades = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']
                  return <Cell key={row.supplier_id || idx} fill={shades[idx % shades.length]} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-4">
        <DataTable
          columns={[
            { key: 'project', label: lang === 'ar' ? 'المشروع' : 'Project' },
            { key: 'billed_net', label: lang === 'ar' ? 'المفوتر (صافي)' : 'Billed Net', render: (row) => <span className="ds-money">{row.billed_net}</span> },
            { key: 'cost_to_date', label: lang === 'ar' ? 'التكلفة حتى الآن' : 'Cost To Date', render: (row) => <span className="ds-money">{row.cost_to_date}</span> },
            { key: 'gross_profit_label', label: lang === 'ar' ? 'الربح الإجمالي' : 'Gross Profit', render: (row) => <span className={`ds-money ${row.gross_profit >= 0 ? 'text-[var(--ds-positive)]' : 'text-[var(--ds-danger)]'}`}>{row.gross_profit_label}</span> },
            { key: 'margin_pct', label: lang === 'ar' ? 'الهامش %' : 'Margin %', render: (row) => <span className="ds-money">{row.margin_pct}</span> },
          ]}
          rows={profitabilityRows}
        />
      </div>

      <div className="mt-4 text-xs text-[var(--ds-muted)]">
        {lang === 'ar' ? `الصلاحية الحالية: ${role}` : `Current role: ${role}`}
      </div>
    </div>
  )
}
