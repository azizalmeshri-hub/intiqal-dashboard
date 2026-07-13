import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
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

  if (loading) {
    return (
      <div className="card">
        <div className="card-label">{lang === 'ar' ? 'تحميل الصحة المالية...' : 'Loading financial health...'}</div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'الصحة المالية' : 'Financial Health'}</h1>

      {error && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>
            {error}
          </div>
        </div>
      )}

      {sanityMismatch && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>
            {sanityMismatch}
          </div>
        </div>
      )}

      {ap > ar && (
        <div className="financial-banner" style={{ marginTop: 12 }}>
          {lang === 'ar'
            ? `الالتزامات تتجاوز المستحقات بمقدار ${fmtMoney(gap)} - نُدير حاليًا قائمة أولوية للمدفوعات.`
            : `Payables exceed receivables by ${fmtMoney(gap)} - managing a payables queue.`}
        </div>
      )}

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'النقد المتاح' : 'Cash On Hand'}</div>
          <div className="card-value mono">{fmtMoney(cashOnHand)}</div>
          <div className="card-sub mono">
            {lang === 'ar'
              ? `تشغيل 4 أسابيع = ${fmtMoney(runway)} (نقد + AR متوقع - AP مستحق)`
              : `4-week runway = ${fmtMoney(runway)} (cash + expected AR - AP due)`}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              disabled={!isAdmin || savingCash}
              style={{ maxWidth: 220 }}
            />
            {isAdmin && (
              <button className="btn secondary" disabled={savingCash} onClick={onSaveCash}>
                {savingCash
                  ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                  : (lang === 'ar' ? 'حفظ النقد المتاح' : 'Save Cash On Hand')}
              </button>
            )}
            {!isAdmin && <span className="card-sub">{lang === 'ar' ? 'عرض فقط' : 'Read-only'}</span>}
          </div>
          {cashError && (
            <div className="tag-note" style={{ marginTop: 8, color: 'var(--red)', background: 'var(--red-dim)' }}>
              {cashError}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-label">AR</div>
          <div className="card-value mono">{fmtMoney(ar)}</div>
          <div className="card-sub">{lang === 'ar' ? 'الحسابات المدينة' : 'Accounts receivable'}</div>
        </div>

        <div className="card">
          <div className="card-label">AP</div>
          <div className="card-value mono">{fmtMoney(ap)}</div>
          <div className="card-sub">{lang === 'ar' ? 'الحسابات الدائنة' : 'Accounts payable'}</div>
        </div>

        <div className={`card ${netPosition < 0 ? 'card-alert' : ''}`}>
          <div className="card-label">{lang === 'ar' ? 'الموقف الصافي' : 'Net Position'}</div>
          <div className="card-value mono">{fmtMoney(netPosition)}</div>
          <div className="card-sub">{lang === 'ar' ? 'عنوان الشهر الحالي' : 'Current headline metric'}</div>
        </div>

        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'استحقاق الاستقطاع' : 'Retention Receivable'}</div>
          <div className="card-value mono">{fmtMoney(retentionReceivable)}</div>
          <div className="card-sub">{lang === 'ar' ? 'غير محصل بعد' : 'Not yet released'}</div>
        </div>

        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'إجمالي الأعمال المتبقية' : 'Backlog Total'}</div>
          <div className="card-value mono">{fmtMoney(backlog.total)}</div>
          <div className="card-sub">
            {lang === 'ar'
              ? `مشاريع بعقد غير معرف: ${backlog.unknownCount}`
              : `Projects with unknown contract: ${backlog.unknownCount}`}
          </div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'نسبة التحصيل' : 'Collection Rate'}</div>
          <div className="card-value mono">{percent.format(collectionRate * 100)}%</div>
        </div>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'AR متوقع خلال 4 أسابيع' : 'Expected AR Next 4 Weeks'}</div>
          <div className="card-value mono">{fmtMoney(expectedAr4w)}</div>
        </div>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'AP مستحق خلال 4 أسابيع' : 'AP Due Next 4 Weeks'}</div>
          <div className="card-value mono">{fmtMoney(apDue4w)}</div>
        </div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'تقادم الذمم (AR/AP)' : 'AR/AP Aging'}</h2>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'AR المفتوح حسب العمر' : 'Open AR by Age'}</div>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'الفئة' : 'Bucket'}</th>
                <th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {arAging.rows.map((row) => (
                <tr key={row.bucket}>
                  <td>{lang === 'ar' ? AGING_BUCKET_LABELS[row.bucket]?.ar || row.bucket : AGING_BUCKET_LABELS[row.bucket]?.en || row.bucket}</td>
                  <td className="num mono">{fmtMoney(row.amount)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>{lang === 'ar' ? 'الإجمالي' : 'Total'}</strong></td>
                <td className="num mono"><strong>{fmtMoney(arAging.total)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'AP المفتوح حسب العمر' : 'Open AP by Age'}</div>
          <table className="table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'الفئة' : 'Bucket'}</th>
                <th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {apAging.rows.map((row) => (
                <tr key={row.bucket}>
                  <td>{lang === 'ar' ? AGING_BUCKET_LABELS[row.bucket]?.ar || row.bucket : AGING_BUCKET_LABELS[row.bucket]?.en || row.bucket}</td>
                  <td className="num mono">{fmtMoney(row.amount)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>{lang === 'ar' ? 'الإجمالي' : 'Total'}</strong></td>
                <td className="num mono"><strong>{fmtMoney(apAging.total)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'الرسوم التحليلية' : 'Analytical Charts'}</h2>
      <div className="grid grid-2">
        <div className="card chart-card">
          <div className="card-label">{lang === 'ar' ? 'تقادم AR مقابل AP' : 'AR vs AP Aging'}</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agingChart} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
              <XAxis dataKey="bucketLabel" stroke="#8fa3b3" fontSize={11} interval={0} angle={lang === 'ar' ? 0 : -20} textAnchor={lang === 'ar' ? 'middle' : 'end'} height={50} />
              <YAxis stroke="#8fa3b3" fontSize={11} />
              <Tooltip
                contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }}
                formatter={(value) => [fmtMoney(value), '']}
              />
              <Legend />
              <Bar dataKey="ar" name="AR" fill="#4f9d6e" radius={[6, 6, 0, 0]} />
              <Bar dataKey="ap" name="AP" fill="#d6584a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="card-label">{lang === 'ar' ? 'التدفقات النقدية الشهرية (داخل/خارج)' : 'Cash In vs Cash Out (Monthly)'}</div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashFlow} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
              <XAxis dataKey="month" stroke="#8fa3b3" fontSize={11} />
              <YAxis stroke="#8fa3b3" fontSize={11} />
              <Tooltip
                contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }}
                formatter={(value) => [fmtMoney(value), '']}
              />
              <Legend />
              <Line type="monotone" dataKey="cashIn" name={lang === 'ar' ? 'داخل' : 'Cash In'} stroke="#4f9d6e" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="cashOut" name={lang === 'ar' ? 'خارج' : 'Cash Out'} stroke="#d6584a" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card chart-card" style={{ marginTop: 16 }}>
        <div className="card-label">{lang === 'ar' ? 'تركيز الموردين (Pareto)' : 'Supplier Concentration (Pareto)'}</div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={supplierConcentration} layout="vertical" margin={{ top: 14, right: 12, left: 20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
            <XAxis type="number" stroke="#8fa3b3" fontSize={11} />
            <YAxis type="category" dataKey="displayName" stroke="#8fa3b3" fontSize={11} width={150} />
            <Tooltip
              contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }}
              formatter={(value) => [fmtMoney(value), lang === 'ar' ? 'مستحق' : 'Outstanding AP']}
            />
            <Bar dataKey="amount" name={lang === 'ar' ? 'AP المفتوح' : 'Outstanding AP'} fill="#e8a33d" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'ربحية المشاريع (مبدئي)' : 'Project Profitability (Mini Table)'}</h2>
      <div className="card">
        <div className="card-sub" style={{ marginBottom: 10 }}>
          {lang === 'ar'
            ? 'التكاليف محسوبة فقط عندما يكون project_id مخصصًا. التكاليف غير المخصصة تظهر في صف Unallocated.'
            : 'Costs include only tagged project_id invoices. Untagged costs are shown in the Unallocated row.'}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
              <th>{lang === 'ar' ? 'المفوتر (صافي)' : 'Billed Net'}</th>
              <th>{lang === 'ar' ? 'التكلفة حتى الآن' : 'Cost To Date'}</th>
              <th>{lang === 'ar' ? 'الربح الإجمالي' : 'Gross Profit'}</th>
              <th>{lang === 'ar' ? 'الهامش %' : 'Margin %'}</th>
            </tr>
          </thead>
          <tbody>
            {profitability.map((row) => {
              const projectLabel = row.is_unallocated
                ? 'Unallocated'
                : (projectNameById[row.project_id] || row.project_id)

              return (
                <tr key={row.project_id}>
                  <td>{projectLabel}</td>
                  <td className="num mono">{fmtMoney(row.billed_net)}</td>
                  <td className="num mono">{fmtMoney(row.cost_to_date)}</td>
                  <td className={`num mono ${row.gross_profit >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(row.gross_profit)}</td>
                  <td className="num mono">{row.margin_pct == null ? '-' : `${percent.format(row.margin_pct)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card-sub" style={{ marginTop: 14 }}>
        {lang === 'ar' ? `الصلاحية الحالية: ${role}` : `Current role: ${role}`}
      </div>
    </div>
  )
}
