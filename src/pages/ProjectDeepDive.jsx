import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import TapeProgress from '../components/TapeProgress'
import EditableTable from '../components/EditableTable'
import RecordFormModal from '../components/RecordFormModal'
import {
  buildActualRevenueCurve,
  buildPlannedRevenueCurve,
  calcBudgetVariance,
  calcCostByCategory,
  calcProjectDeepDiveMetrics,
  mergeRevenueCurves,
} from '../lib/calc'

const DEBOUNCE_MS = 800

function toNum(v) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

function looksLikeMissingDeletedAt(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('deleted_at') && msg.includes('column')
}

async function fetchTable({ table, select, eq = null, order = null, softDelete = false }) {
  let query = supabase.from(table).select(select)
  if (eq) query = query.eq(eq.column, eq.value)
  if (softDelete) query = query.is('deleted_at', null)
  if (order) query = query.order(order.column, { ascending: order.ascending !== false })

  const first = await query
  if (!first.error) return first

  if (softDelete && looksLikeMissingDeletedAt(first.error)) {
    let fallback = supabase.from(table).select(select)
    if (eq) fallback = fallback.eq(eq.column, eq.value)
    if (order) fallback = fallback.order(order.column, { ascending: order.ascending !== false })
    return fallback
  }

  return first
}

function buildGanttRows(milestones) {
  return [...(milestones || [])]
    .filter((m) => m.start_date && m.end_date)
    .sort((a, b) => {
      const sa = String(a.sort_order ?? '')
      const sb = String(b.sort_order ?? '')
      if (sa && sb && sa !== sb) return Number(sa) - Number(sb)
      return String(a.start_date).localeCompare(String(b.start_date))
    })
}

function ProjectGantt({ rows, lang }) {
  const normalized = buildGanttRows(rows)
  if (!normalized.length) return null

  const minTs = Math.min(...normalized.map((r) => new Date(r.start_date).getTime()))
  const maxTs = Math.max(...normalized.map((r) => new Date(r.end_date).getTime()))
  const span = Math.max(maxTs - minTs, 24 * 60 * 60 * 1000)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={900} height={Math.max(220, normalized.length * 38 + 24)}>
        {normalized.map((row, idx) => {
          const y = idx * 38 + 24
          const start = new Date(row.start_date).getTime()
          const end = new Date(row.end_date).getTime()
          const x = 190 + ((start - minTs) / span) * 660
          const w = Math.max((((end - start) / span) * 660), 6)
          const done = Math.max(0, Math.min(100, toNum(row.pct_done)))
          const doneW = (w * done) / 100
          const label = lang === 'ar' ? (row.name_ar || row.name_en || row.id) : (row.name_en || row.name_ar || row.id)

          return (
            <g key={row.id || idx}>
              <text x={10} y={y + 13} fill="#cdd8e0" fontSize="12">{label}</text>
              <rect x={x} y={y} width={w} height={14} rx={5} fill="#30495f" />
              <rect x={x} y={y} width={doneW} height={14} rx={5} fill="#e8a33d" />
              <text x={x + w + 8} y={y + 12} fill="#8fa3b3" fontSize="11">{`${done.toFixed(0)}%`}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function useInlineAutosaveTable({
  table,
  initialRows,
  canEdit,
  softDelete,
  defaultInsert,
  onChanged,
}) {
  const [rows, setRows] = useState(initialRows)
  const [statusByCell, setStatusByCell] = useState({})
  const [globalError, setGlobalError] = useState('')
  const [openAdd, setOpenAdd] = useState(false)

  const rowsRef = useRef(rows)
  const pendingRef = useRef({})
  const timersRef = useRef({})

  useEffect(() => {
    setRows(initialRows)
  }, [initialRows])

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const flushField = async (rowId, field) => {
    const patch = pendingRef.current[rowId]?.[field]
    if (patch === undefined) return

    try {
      if (!canEdit) throw new Error("You don't have permission to edit")
      const { error } = await supabase.from(table).update({ [field]: patch }).eq('id', rowId)
      if (error) throw error
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'saved' }))
      onChanged?.()
    } catch (error) {
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'retry' }))
      setGlobalError(error?.message || 'Update failed')
    } finally {
      if (pendingRef.current[rowId]) delete pendingRef.current[rowId][field]
    }
  }

  const onChangeCell = (rowId, field, value) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)))

    pendingRef.current[rowId] = { ...(pendingRef.current[rowId] || {}), [field]: value }
    const key = `${rowId}:${field}`
    setStatusByCell((prev) => ({ ...prev, [key]: 'saving' }))

    if (timersRef.current[key]) clearTimeout(timersRef.current[key])
    timersRef.current[key] = setTimeout(() => flushField(rowId, field), DEBOUNCE_MS)
  }

  const addRow = async (values) => {
    if (!canEdit) throw new Error("You don't have permission to edit")
    const payload = { ...defaultInsert, ...values }
    const { data, error } = await supabase.from(table).insert(payload).select().single()
    if (error) throw error
    setRows((prev) => [data, ...prev])
    setOpenAdd(false)
    onChanged?.()
  }

  const deleteRow = async (row) => {
    if (!canEdit) return

    if (softDelete) {
      const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', row.id)
      if (error) {
        setGlobalError(error?.message || 'Delete failed')
        return
      }
    } else {
      const { error } = await supabase.from(table).delete().eq('id', row.id)
      if (error) {
        setGlobalError(error?.message || 'Delete failed')
        return
      }
    }

    setRows((prev) => prev.filter((r) => r.id !== row.id))
    onChanged?.()
  }

  return {
    rows,
    setRows,
    statusByCell,
    globalError,
    onChangeCell,
    addRow,
    deleteRow,
    openAdd,
    setOpenAdd,
  }
}

export default function ProjectDeepDive() {
  const { id } = useParams()
  const { lang } = useLang()
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

  const [project, setProject] = useState(null)
  const [client, setClient] = useState(null)
  const [parties, setParties] = useState([])
  const [milestones, setMilestones] = useState([])
  const [budgets, setBudgets] = useState([])
  const [categories, setCategories] = useState([])
  const [projectInvoices, setProjectInvoices] = useState([])
  const [projectPayments, setProjectPayments] = useState([])
  const [projectSupplierInvoices, setProjectSupplierInvoices] = useState([])
  const [unallocatedCosts, setUnallocatedCosts] = useState(0)

  useEffect(() => {
    const refresh = () => setRefreshTick((v) => v + 1)
    window.addEventListener('intiqal:data-changed', refresh)
    return () => window.removeEventListener('intiqal:data-changed', refresh)
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')

      try {
        const projectRes = await fetchTable({ table: 'projects', select: '*', eq: { column: 'id', value: id } })
        if (projectRes.error) throw projectRes.error
        const p = projectRes.data?.[0]
        if (!p) throw new Error('Project not found')

        const [
          invRes,
          payRes,
          supInvRes,
          milestoneRes,
          budgetRes,
          partiesRes,
          categoriesRes,
          unallocatedRes,
        ] = await Promise.all([
          fetchTable({ table: 'client_invoices', select: '*', eq: { column: 'project_id', value: id }, softDelete: true, order: { column: 'invoice_date', ascending: false } }),
          fetchTable({ table: 'client_payments', select: '*', eq: { column: 'project_id', value: id }, softDelete: true, order: { column: 'payment_date', ascending: false } }),
          fetchTable({ table: 'supplier_invoices', select: '*', eq: { column: 'project_id', value: id }, softDelete: true, order: { column: 'invoice_date', ascending: false } }),
          fetchTable({ table: 'milestones', select: '*', eq: { column: 'project_id', value: id }, softDelete: true, order: { column: 'sort_order', ascending: true } }),
          fetchTable({ table: 'project_budgets', select: '*', eq: { column: 'project_id', value: id }, softDelete: true }),
          fetchTable({ table: 'project_parties', select: '*', eq: { column: 'project_id', value: id }, softDelete: true }),
          fetchTable({ table: 'cost_categories', select: '*', softDelete: true }),
          supabase.from('supplier_invoices').select('amount_net,project_id,deleted_at').is('deleted_at', null).is('project_id', null),
        ])

        const errors = [invRes.error, payRes.error, supInvRes.error].filter(Boolean)
        if (errors.length) throw errors[0]

        let clientRow = null
        if (p.client_id) {
          const cRes = await fetchTable({ table: 'clients', select: '*', eq: { column: 'id', value: p.client_id } })
          if (!cRes.error) clientRow = cRes.data?.[0] || null
        }

        if (!active) return
        setProject(p)
        setClient(clientRow)
        setProjectInvoices(invRes.data || [])
        setProjectPayments(payRes.data || [])
        setProjectSupplierInvoices(supInvRes.data || [])
        setMilestones(milestoneRes.error ? [] : (milestoneRes.data || []))
        setBudgets(budgetRes.error ? [] : (budgetRes.data || []))
        setParties(partiesRes.error ? [] : (partiesRes.data || []))
        setCategories(categoriesRes.error ? [] : (categoriesRes.data || []))
        setUnallocatedCosts((unallocatedRes.data || []).reduce((sum, row) => sum + toNum(row.amount_net), 0))
      } catch (err) {
        if (!active) return
        setError(err?.message || 'Failed to load project')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [id, refreshTick])

  const categoryNameById = useMemo(() => {
    const map = {}
    for (const c of categories) {
      map[c.id] = lang === 'ar' ? (c.name_ar || c.name_en || c.id) : (c.name_en || c.name_ar || c.id)
    }
    return map
  }, [categories, lang])

  const metrics = useMemo(
    () => calcProjectDeepDiveMetrics(project, projectInvoices, projectPayments, projectSupplierInvoices),
    [project, projectInvoices, projectPayments, projectSupplierInvoices],
  )

  const invoicePaidById = useMemo(() => {
    const map = new Map()
    for (const p of projectPayments) {
      if (!p.client_invoice_id) continue
      map.set(p.client_invoice_id, (map.get(p.client_invoice_id) || 0) + toNum(p.amount))
    }
    return map
  }, [projectPayments])

  const invoiceRows = useMemo(() => projectInvoices.map((inv) => {
    const paid = invoicePaidById.get(inv.id) || 0
    const target = toNum(inv.amount_gross) - toNum(inv.retention_amount)
    const payment_state = paid >= target && target > 0
      ? (lang === 'ar' ? 'مدفوع' : 'Paid')
      : (lang === 'ar' ? 'غير مدفوع' : 'Unpaid')
    return { ...inv, payment_state }
  }), [projectInvoices, invoicePaidById, lang])

  const costByCategory = useMemo(
    () => calcCostByCategory(projectSupplierInvoices, categoryNameById),
    [projectSupplierInvoices, categoryNameById],
  )

  const budgetVariance = useMemo(() => {
    if (!budgets.length) return []
    const mapped = budgets.map((row) => ({
      ...row,
      category_name: categoryNameById[row.cost_category_id] || row.category_name,
    }))
    return calcBudgetVariance(mapped, costByCategory)
  }, [budgets, categoryNameById, costByCategory])

  const revenueCurve = useMemo(() => {
    const actual = buildActualRevenueCurve(projectInvoices)
    const planned = buildPlannedRevenueCurve(milestones, project?.contract_value_net, metrics.billed_net)
    return mergeRevenueCurves(actual, planned)
  }, [projectInvoices, milestones, project, metrics.billed_net])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const pct = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }), [])

  const formatMoney = (value) => `${money.format(toNum(value))} SAR`

  const revenueColumns = useMemo(() => [
    { key: 'invoice_no', label: 'No', labelAr: 'رقم المستخلص' },
    { key: 'invoice_date', label: 'Date', labelAr: 'التاريخ', type: 'date' },
    { key: 'amount_net', label: 'Net', labelAr: 'صافي', type: 'number' },
    { key: 'vat_amount', label: 'VAT', labelAr: 'ضريبة', type: 'number' },
    { key: 'retention_amount', label: 'Retention', labelAr: 'استقطاع', type: 'number' },
    { key: 'amount_gross', label: 'Gross', labelAr: 'إجمالي', type: 'number' },
    {
      key: 'status',
      label: 'Status',
      labelAr: 'الحالة',
      type: 'select',
      options: [
        { value: 'draft', label: lang === 'ar' ? 'مسودة' : 'Draft' },
        { value: 'submitted', label: lang === 'ar' ? 'مرسل' : 'Submitted' },
        { value: 'approved', label: lang === 'ar' ? 'معتمد' : 'Approved' },
        { value: 'partially_paid', label: lang === 'ar' ? 'مدفوع جزئيًا' : 'Partially Paid' },
        { value: 'paid', label: lang === 'ar' ? 'مدفوع' : 'Paid' },
      ],
    },
    { key: 'payment_state', label: 'Paid/Unpaid', labelAr: 'مدفوع/غير مدفوع', editable: false },
  ], [lang])

  const milestoneColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'الاسم (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'الاسم (EN)' },
    { key: 'start_date', label: 'Start', labelAr: 'البداية', type: 'date' },
    { key: 'end_date', label: 'End', labelAr: 'النهاية', type: 'date' },
    { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'number' },
    { key: 'pct_done', label: '% Done', labelAr: '% الإنجاز', type: 'number' },
    { key: 'depends_on', label: 'Depends On', labelAr: 'يعتمد على' },
    { key: 'sort_order', label: 'Order', labelAr: 'الترتيب', type: 'number' },
  ], [])

  const invoiceTable = useInlineAutosaveTable({
    table: 'client_invoices',
    initialRows: invoiceRows,
    canEdit: isAdmin,
    softDelete: true,
    defaultInsert: { project_id: id, status: 'submitted', amount_net: 0, vat_amount: 0, retention_amount: 0, amount_gross: 0 },
    onChanged: () => window.dispatchEvent(new Event('intiqal:data-changed')),
  })

  const milestoneTable = useInlineAutosaveTable({
    table: 'milestones',
    initialRows: milestones,
    canEdit: isAdmin,
    softDelete: false,
    defaultInsert: { project_id: id, weight: 0, pct_done: 0, sort_order: 0 },
    onChanged: () => window.dispatchEvent(new Event('intiqal:data-changed')),
  })

  const partiesLabel = useMemo(() => {
    if (!parties.length) return lang === 'ar' ? 'لا توجد جهات مرتبطة' : 'No project parties'
    return parties
      .map((row) => {
        const name = row.name || row.party_name || row.contact_name || row.name_en || row.name_ar || row.role || row.id
        const role = row.role ? ` (${row.role})` : ''
        return `${name}${role}`
      })
      .join(' • ')
  }, [parties, lang])

  if (loading) {
    return (
      <div className="card">
        <div className="card-label">{lang === 'ar' ? 'تحميل تفاصيل المشروع...' : 'Loading project deep-dive...'}</div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="card">
        <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error || 'Project not found'}</div>
      </div>
    )
  }

  const projectName = lang === 'ar' ? (project.name_ar || project.name_en || project.id) : (project.name_en || project.name_ar || project.id)
  const clientName = client ? (lang === 'ar' ? (client.name_ar || client.name_en) : (client.name_en || client.name_ar)) : '-'
  const contractIsSet = toNum(project.contract_value_net) > 0
  const isAjdan = /ajdan|أجدان/i.test(`${project.name_en || ''} ${project.name_ar || ''}`)

  const sanityLines = []
  if (isAjdan) {
    const billedOk = Math.abs(metrics.billed_net - 8094055) <= 8094055 * 0.1
    const collectedOk = Math.abs(metrics.collected - 7785981) <= 7785981 * 0.1
    const pctBilled = contractIsSet ? ((metrics.billed_net / toNum(project.contract_value_net)) * 100) : 0
    const pctOk = Math.abs(pctBilled - 13.5) <= 2
    const receivableOk = Math.abs(metrics.receivable - 1183760) <= 1183760 * 0.12

    if (!(billedOk && collectedOk && pctOk && receivableOk)) {
      sanityLines.push(
        lang === 'ar'
          ? `تحقق أجدان: مفوتر=${formatMoney(metrics.billed_net)} | محصل=${formatMoney(metrics.collected)} | %فوترة=${pct.format(pctBilled)}% | مستحق=${formatMoney(metrics.receivable)}`
          : `Ajdan check: billed=${formatMoney(metrics.billed_net)} | collected=${formatMoney(metrics.collected)} | %billed=${pct.format(pctBilled)}% | receivable=${formatMoney(metrics.receivable)}`,
      )
    }
  }

  return (
    <div>
      <h1 className="display">{projectName}</h1>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="info-row"><span>{lang === 'ar' ? 'العميل' : 'Client'}</span><span>{clientName}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'الحالة' : 'Status'}</span><span>{project.status || '-'}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'الأطراف' : 'Parties'}</span><span>{partiesLabel}</span></div>
      </div>

      {!contractIsSet && (
        <div className="tag-note" style={{ marginTop: 10, color: 'var(--amber)', background: 'var(--amber-dim)' }}>
          {lang === 'ar' ? 'قيمة العقد غير محددة لهذا المشروع - نسبة الفوترة والأعمال المتبقية لن تُعرض رقمياً.' : 'Contract value not set for this project - % billed and backlog are shown as not set.'}
        </div>
      )}

      {sanityLines.length > 0 && (
        <div className="tag-note" style={{ marginTop: 10, color: 'var(--amber)', background: 'var(--amber-dim)' }}>
          {sanityLines[0]}
        </div>
      )}

      <div className="grid grid-3" style={{ marginTop: 14 }}>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'قيمة العقد' : 'Contract Value'}</div><div className="card-value mono">{formatMoney(project.contract_value_net)}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'نسبة الفوترة' : '% Billed'}</div><div className="card-value mono">{contractIsSet ? `${pct.format(metrics.pct_billed)}%` : (lang === 'ar' ? 'قيمة العقد غير محددة' : 'Contract value not set')}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'النسبة الفعلية' : '% Physical'}</div><div className="card-value mono">{pct.format(metrics.pct_physical)}%</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'الأعمال المتبقية' : 'Backlog'}</div><div className="card-value mono">{contractIsSet ? formatMoney(metrics.backlog) : '-'}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'المستحق' : 'Receivable'}</div><div className="card-value mono">{formatMoney(metrics.receivable)}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'الهامش' : 'Margin %'}</div><div className="card-value mono">{metrics.margin_pct == null ? '-' : `${pct.format(metrics.margin_pct)}%`}</div></div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'التقدم' : 'Progress'}</h2>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'التقدم المالي' : 'Financial Progress'}</div>
          <TapeProgress percent={contractIsSet ? metrics.pct_billed : 0} />
          {!contractIsSet && <div className="card-sub">{lang === 'ar' ? 'قيمة العقد غير محددة' : 'Contract value not set'}</div>}
        </div>
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'التقدم الفعلي' : 'Physical Progress'}</div>
          <TapeProgress percent={metrics.pct_physical} />
        </div>
      </div>

      <div className="card chart-card" style={{ marginTop: 14 }}>
        <div className="card-label">{lang === 'ar' ? 'منحنى S (تراكمي)' : 'S-Curve (Cumulative)'}</div>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={revenueCurve} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
            <XAxis dataKey="month" stroke="#8fa3b3" fontSize={11} />
            <YAxis stroke="#8fa3b3" fontSize={11} />
            <Tooltip contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }} formatter={(v) => [formatMoney(v), '']} />
            <Legend />
            <Line type="monotone" dataKey="actual" name={lang === 'ar' ? 'فعلي' : 'Actual'} stroke="#4f9d6e" strokeWidth={2.5} dot={false} />
            {milestones.length > 0 && <Line type="monotone" dataKey="planned" name={lang === 'ar' ? 'مخطط' : 'Planned'} stroke="#e8a33d" strokeWidth={2.5} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'الإيرادات (المستخلصات)' : 'Revenue (Client Invoices)'}</h2>
      {invoiceTable.globalError && <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{invoiceTable.globalError}</div>}
      <EditableTable
        title={lang === 'ar' ? 'جدول المستخلصات' : 'Invoice Table'}
        lang={lang}
        columns={revenueColumns}
        rows={invoiceTable.rows}
        canEdit={isAdmin}
        onChangeCell={invoiceTable.onChangeCell}
        onDeleteRow={invoiceTable.deleteRow}
        onOpenAdd={() => invoiceTable.setOpenAdd(true)}
        statusByCell={invoiceTable.statusByCell}
        rowWarnings={{}}
        rowErrors={{}}
        emptyLabel={lang === 'ar' ? 'لا توجد فواتير' : 'No invoices'}
      />
      <RecordFormModal
        open={invoiceTable.openAdd}
        title={lang === 'ar' ? 'إضافة مستخلص' : 'Add Invoice'}
        columns={revenueColumns.filter((c) => c.key !== 'payment_state')}
        initialValues={{}}
        submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
        onClose={() => invoiceTable.setOpenAdd(false)}
        onSubmit={invoiceTable.addRow}
        lang={lang}
      />

      <div className="grid grid-4" style={{ marginTop: 12 }}>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'مفوتر (صافي)' : 'Billed Net'}</div><div className="card-value mono">{formatMoney(metrics.billed_net)}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'محصل' : 'Collected'}</div><div className="card-value mono">{formatMoney(metrics.collected)}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'متبقي' : 'Outstanding'}</div><div className="card-value mono">{formatMoney(metrics.receivable)}</div></div>
        <div className="card"><div className="card-label">{lang === 'ar' ? 'استقطاع محتجز' : 'Retention Held'}</div><div className="card-value mono">{formatMoney(metrics.retention_held)}</div></div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'التكلفة' : 'Cost'}</h2>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-label">{lang === 'ar' ? 'التكلفة حسب الفئة' : 'Cost by Category'}</div>
          <table className="table">
            <thead><tr><th>{lang === 'ar' ? 'الفئة' : 'Category'}</th><th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead>
            <tbody>
              {costByCategory.map((row) => (
                <tr key={row.category_id}><td>{row.category_name}</td><td className="num mono">{formatMoney(row.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card chart-card">
          <div className="card-label">{lang === 'ar' ? 'توزيع التكلفة' : 'Cost Distribution'}</div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={costByCategory} dataKey="amount" nameKey="category_name" innerRadius={60} outerRadius={100}>
                {costByCategory.map((_, i) => <Cell key={i} fill={["#e8a33d", "#4f9d6e", "#d6584a", "#6a8fb0", "#7f6ab0"][i % 5]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }} formatter={(v) => [formatMoney(v), '']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-label">{lang === 'ar' ? 'الميزانية مقابل الفعلي' : 'Budget vs Actual'}</div>
        {budgetVariance.length === 0 ? (
          <div className="card-sub">{lang === 'ar' ? 'لا توجد ميزانية محددة - أضف ميزانيات لتفعيل الانحراف.' : 'No budget set - add budgets to enable variance.'}</div>
        ) : (
          <table className="table">
            <thead><tr><th>{lang === 'ar' ? 'الفئة' : 'Category'}</th><th>{lang === 'ar' ? 'الميزانية' : 'Budget'}</th><th>{lang === 'ar' ? 'الفعلي' : 'Actual'}</th><th>{lang === 'ar' ? 'الانحراف' : 'Variance'}</th></tr></thead>
            <tbody>
              {budgetVariance.map((row) => (
                <tr key={row.category_id}>
                  <td>{row.category_name}</td>
                  <td className="num mono">{formatMoney(row.budget)}</td>
                  <td className="num mono">{formatMoney(row.actual)}</td>
                  <td className={`num mono ${row.variance >= 0 ? 'pos' : 'neg'}`}>{formatMoney(row.variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="card-sub" style={{ marginTop: 10 }}>
          {lang === 'ar'
            ? `التكاليف غير المخصصة على مستوى الشركة (غير معروضة هنا): ${formatMoney(unallocatedCosts)}`
            : `Unallocated company costs not shown here: ${formatMoney(unallocatedCosts)}`}
        </div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'الجدول الزمني (Gantt)' : 'Schedule (Gantt)'}</h2>
      {milestoneTable.globalError && <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{milestoneTable.globalError}</div>}

      {milestoneTable.rows.length === 0 ? (
        <div className="card">
          <div className="card-sub">{lang === 'ar' ? 'لا توجد مراحل بعد.' : 'No milestones yet.'}</div>
          {isAdmin && (
            <button className="btn" style={{ marginTop: 10 }} onClick={() => milestoneTable.setOpenAdd(true)}>
              {lang === 'ar' ? 'إضافة أول مرحلة' : 'Add first milestone'}
            </button>
          )}
        </div>
      ) : (
        <>
          <EditableTable
            title={lang === 'ar' ? 'المراحل' : 'Milestones'}
            lang={lang}
            columns={milestoneColumns}
            rows={milestoneTable.rows}
            canEdit={isAdmin}
            onChangeCell={milestoneTable.onChangeCell}
            onDeleteRow={milestoneTable.deleteRow}
            onOpenAdd={() => milestoneTable.setOpenAdd(true)}
            statusByCell={milestoneTable.statusByCell}
            rowWarnings={{}}
            rowErrors={{}}
            emptyLabel={lang === 'ar' ? 'لا توجد مراحل' : 'No milestones'}
          />
          <div className="card">
            <ProjectGantt rows={milestoneTable.rows} lang={lang} />
          </div>
        </>
      )}

      <RecordFormModal
        open={milestoneTable.openAdd}
        title={lang === 'ar' ? 'إضافة مرحلة' : 'Add Milestone'}
        columns={milestoneColumns}
        initialValues={{}}
        submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
        onClose={() => milestoneTable.setOpenAdd(false)}
        onSubmit={milestoneTable.addRow}
        lang={lang}
      />

      <div className="card-sub" style={{ marginTop: 12 }}>
        {lang === 'ar' ? 'ملاحظة: العرض قابل للتحرير للمسؤولين فقط.' : 'Note: editing is available to admins only.'}
      </div>
    </div>
  )
}
