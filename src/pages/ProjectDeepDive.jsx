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
import EditableTable from '../components/EditableTable'
import RecordFormModal from '../components/RecordFormModal'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import KpiCard from '../components/ui/KpiCard'
import ProgressBar from '../components/ui/ProgressBar'
import DataTable from '../components/ui/DataTable'
import { Card, CardTitle } from '../components/ui/Card'
import {
  buildActualRevenueCurve,
  buildPlannedRevenueCurve,
  calcBudgetVariance,
  calcCostByCategory,
  calcProjectDeepDiveMetrics,
  mergeRevenueCurves,
} from '../lib/calc'

const DEBOUNCE_MS = 800

const MOCK_MILESTONES = [
  {
    id: 'mock-1',
    name_en: 'Mobilization & site setup',
    name_ar: 'Mobilization & site setup',
    start_date: '2025-12-22',
    end_date: '2026-01-15',
    weight: 5,
    pct_done: 100,
    depends_on: '',
    sort_order: 1,
  },
  {
    id: 'mock-2',
    name_en: 'Excavation',
    name_ar: 'Excavation',
    start_date: '2026-01-10',
    end_date: '2026-03-15',
    weight: 20,
    pct_done: 90,
    depends_on: 'mock-1',
    sort_order: 2,
  },
  {
    id: 'mock-3',
    name_en: 'Infrastructure (utilities)',
    name_ar: 'Infrastructure (utilities)',
    start_date: '2026-03-01',
    end_date: '2026-06-30',
    weight: 25,
    pct_done: 40,
    depends_on: 'mock-2',
    sort_order: 3,
  },
  {
    id: 'mock-4',
    name_en: 'Duplex construction',
    name_ar: 'Duplex construction',
    start_date: '2026-06-01',
    end_date: '2026-12-31',
    weight: 45,
    pct_done: 10,
    depends_on: 'mock-3',
    sort_order: 4,
  },
  {
    id: 'mock-5',
    name_en: 'Finishing & handover',
    name_ar: 'Finishing & handover',
    start_date: '2026-11-01',
    end_date: '2027-02-28',
    weight: 5,
    pct_done: 0,
    depends_on: 'mock-4',
    sort_order: 5,
  },
]

function toNum(v) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

function looksLikeMissingDeletedAt(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('deleted_at') && msg.includes('column')
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

async function resolveProjectByRouteId(routeId) {
  if (!routeId) return { data: null, error: new Error('Missing project id') }

  if (isUuid(routeId)) {
    const byId = await supabase.from('projects').select('*').eq('id', routeId).maybeSingle()
    return { data: byId.data || null, error: byId.error }
  }

  const token = String(routeId).trim().toLowerCase()
  const slugMap = {
    ajdan: ['ajdan', 'أجدان'],
    sadra: ['sadra', 'سدرة'],
  }
  const terms = slugMap[token] || [token]

  for (const term of terms) {
    const byNameEn = await supabase.from('projects').select('*').ilike('name_en', `%${term}%`).limit(1)
    if (!byNameEn.error && byNameEn.data?.[0]) return { data: byNameEn.data[0], error: null }

    const byNameAr = await supabase.from('projects').select('*').ilike('name_ar', `%${term}%`).limit(1)
    if (!byNameAr.error && byNameAr.data?.[0]) return { data: byNameAr.data[0], error: null }
  }

  return { data: null, error: null }
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

function getMilestoneName(milestone, lang) {
  if (!milestone) return ''
  return lang === 'ar'
    ? (milestone.name_ar || milestone.name_en || milestone.id)
    : (milestone.name_en || milestone.name_ar || milestone.id)
}

function getDependsOnLabel(milestone, rows, lang) {
  const depId = milestone?.depends_on
  if (!depId) return ''
  const dep = (rows || []).find((r) => String(r.id) === String(depId))
  if (dep) return getMilestoneName(dep, lang)
  return String(depId)
}

function getMilestoneDependencyOptions(currentRow, rows, lang) {
  const options = (rows || [])
    .filter((m) => String(m.id) !== String(currentRow?.id))
    .map((m) => ({ value: m.id, label: getMilestoneName(m, lang) }))

  options.sort((a, b) => a.label.localeCompare(b.label))
  return options
}

function validateMilestoneDependencyChange(rows, rowId, nextDependsOn, lang) {
  if (!nextDependsOn) return ''

  if (String(nextDependsOn) === String(rowId)) {
    return lang === 'ar'
      ? 'لا يمكن أن تعتمد المرحلة على نفسها.'
      : 'A milestone cannot depend on itself.'
  }

  const target = (rows || []).find((r) => String(r.id) === String(nextDependsOn))
  if (target && String(target.depends_on || '') === String(rowId)) {
    return lang === 'ar'
      ? 'اعتماد دائري مباشر غير مسموح (A ↔ B).'
      : 'Direct circular dependency is not allowed (A ↔ B).'
  }

  return ''
}

function ProjectGantt({ rows, lang }) {
  const normalized = buildGanttRows(rows)
  if (!normalized.length) return null

  const minTs = Math.min(...normalized.map((r) => new Date(r.start_date).getTime()))
  const maxTs = Math.max(...normalized.map((r) => new Date(r.end_date).getTime()))
  const span = Math.max(maxTs - minTs, 24 * 60 * 60 * 1000)
  const labelCol = 280
  const timelineWidth = 660
  const chartWidth = labelCol + timelineWidth + 70
  const labelX = lang === 'ar' ? labelCol - 10 : 12
  const labelAnchor = lang === 'ar' ? 'end' : 'start'

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={chartWidth} height={Math.max(220, normalized.length * 38 + 24)}>
        {normalized.map((row, idx) => {
          const y = idx * 38 + 24
          const start = new Date(row.start_date).getTime()
          const end = new Date(row.end_date).getTime()
          const x = labelCol + ((start - minTs) / span) * timelineWidth
          const w = Math.max((((end - start) / span) * timelineWidth), 6)
          const done = Math.max(0, Math.min(100, toNum(row.pct_done)))
          const doneW = (w * done) / 100
          const label = lang === 'ar' ? (row.name_ar || row.name_en || row.id) : (row.name_en || row.name_ar || row.id)

          return (
            <g key={row.id || idx}>
              <text x={labelX} y={y + 13} fill="#cdd8e0" fontSize="12" textAnchor={labelAnchor} direction="ltr" unicodeBidi="plaintext">{label}</text>
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
  transformCellValue,
  validateCellChange,
  onDeleteSuccess,
}) {
  const [rows, setRows] = useState(initialRows)
  const [statusByCell, setStatusByCell] = useState({})
  const [warningByCell, setWarningByCell] = useState({})
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
    const key = `${rowId}:${field}`
    const currentRows = rowsRef.current || []
    const warning = validateCellChange?.({ rowId, field, value, rows: currentRows }) || ''
    if (warning) {
      setWarningByCell((prev) => ({ ...prev, [key]: warning }))
      return
    }

    setWarningByCell((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

    const finalValue = transformCellValue ? transformCellValue({ rowId, field, value, rows: currentRows }) : value
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: finalValue } : r)))

    pendingRef.current[rowId] = { ...(pendingRef.current[rowId] || {}), [field]: finalValue }
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
    onDeleteSuccess?.(row, setRows)
    onChanged?.()
  }

  return {
    rows,
    setRows,
    statusByCell,
    warningByCell,
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
        if (!id) {
          if (!active) return
          setError('Missing project id')
          return
        }

        const resolved = await resolveProjectByRouteId(id)
        if (resolved.error) throw resolved.error
        const p = resolved.data
        if (!p) throw new Error('Project not found')

        const projectId = p.id

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
          fetchTable({ table: 'client_invoices', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: true, order: { column: 'invoice_date', ascending: false } }),
          fetchTable({ table: 'client_payments', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: true, order: { column: 'payment_date', ascending: false } }),
          fetchTable({ table: 'supplier_invoices', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: true, order: { column: 'invoice_date', ascending: false } }),
          fetchTable({ table: 'milestones', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: false, order: { column: 'sort_order', ascending: true } }),
          fetchTable({ table: 'project_budgets', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: false }),
          fetchTable({ table: 'project_parties', select: '*', eq: { column: 'project_id', value: projectId }, softDelete: false }),
          fetchTable({ table: 'cost_categories', select: '*', softDelete: false }),
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

  const useMockMilestones = milestones.length === 0
  const effectiveMilestones = useMemo(
    () => (useMockMilestones ? MOCK_MILESTONES : milestones),
    [useMockMilestones, milestones],
  )
  const canEditMilestones = isAdmin && !useMockMilestones

  const revenueCurve = useMemo(() => {
    const actual = buildActualRevenueCurve(projectInvoices)
    const planned = buildPlannedRevenueCurve(effectiveMilestones, project?.contract_value_net, metrics.billed_net)
    return mergeRevenueCurves(actual, planned)
  }, [projectInvoices, effectiveMilestones, project, metrics.billed_net])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const pct = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }), [])

  const formatMoney = (value) => `${money.format(toNum(value))} SAR`
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

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
    {
      key: 'depends_on',
      label: 'Depends On',
      labelAr: 'يعتمد على',
      type: 'select',
      emptyOptionLabel: lang === 'ar' ? '— بدون —' : '— none —',
      getOptions: (row, rows) => getMilestoneDependencyOptions(row, rows, lang),
      renderValue: (row, rows, activeLang) => getDependsOnLabel(row, rows, activeLang),
    },
    { key: 'sort_order', label: 'Order', labelAr: 'الترتيب', type: 'number' },
  ], [lang])

  const invoiceTable = useInlineAutosaveTable({
    table: 'client_invoices',
    initialRows: invoiceRows,
    canEdit: isAdmin,
    softDelete: true,
    defaultInsert: { project_id: project?.id || null, status: 'submitted', amount_net: 0, vat_amount: 0, retention_amount: 0, amount_gross: 0 },
    onChanged: () => window.dispatchEvent(new Event('intiqal:data-changed')),
  })

  const milestoneTable = useInlineAutosaveTable({
    table: 'milestones',
    initialRows: effectiveMilestones,
    canEdit: canEditMilestones,
    softDelete: false,
    defaultInsert: { project_id: project?.id || null, weight: 0, pct_done: 0, sort_order: 0, depends_on: null },
    transformCellValue: ({ field, value }) => {
      if (field === 'depends_on') return value || null
      return value
    },
    validateCellChange: ({ rowId, field, value, rows }) => {
      if (field !== 'depends_on') return ''
      return validateMilestoneDependencyChange(rows, rowId, value, lang)
    },
    onDeleteSuccess: (deletedRow, setRows) => {
      if (!deletedRow?.id) return
      setRows((prev) => prev.map((row) => (
        String(row.depends_on || '') === String(deletedRow.id)
          ? { ...row, depends_on: null }
          : row
      )))
    },
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
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <CardTitle>{lang === 'ar' ? 'تحميل تفاصيل المشروع...' : 'Loading project deep-dive...'}</CardTitle>
        </Card>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card className="border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error || 'Project not found'}</div>
        </Card>
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

  const costRows = costByCategory.map((row) => ({
    id: row.category_id,
    category: row.category_name,
    amount: formatMoney(row.amount),
  }))

  const varianceRows = budgetVariance.map((row) => ({
    id: row.category_id,
    category: row.category_name,
    budget: formatMoney(row.budget),
    actual: formatMoney(row.actual),
    variance: row.variance,
    varianceLabel: formatMoney(row.variance),
  }))

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={projectName}
        dateText={todayLabel}
        subtitle={`${lang === 'ar' ? 'العميل' : 'Client'}: ${clientName} | ${lang === 'ar' ? 'الحالة' : 'Status'}: ${project.status || '-'}`}
      />

      <Card className="mb-4">
        <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'الأطراف' : 'Parties'}</div>
        <div className="mt-1 text-sm font-semibold text-[var(--ds-text)]">{partiesLabel}</div>
      </Card>

      {!contractIsSet && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-sm font-semibold text-amber-700">
          {lang === 'ar' ? 'قيمة العقد غير محددة لهذا المشروع - نسبة الفوترة والأعمال المتبقية لن تُعرض رقمياً.' : 'Contract value not set for this project - % billed and backlog are shown as not set.'}
          </div>
        </Card>
      )}

      {sanityLines.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-sm font-semibold text-amber-700">
          {sanityLines[0]}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label={lang === 'ar' ? 'قيمة العقد' : 'Contract Value'} value={formatMoney(project.contract_value_net)} />
        <KpiCard label={lang === 'ar' ? 'نسبة الفوترة' : '% Billed'} value={contractIsSet ? `${pct.format(metrics.pct_billed)}%` : (lang === 'ar' ? 'قيمة العقد غير محددة' : 'Contract not set')} />
        <KpiCard label={lang === 'ar' ? 'النسبة الفعلية' : '% Physical'} value={`${pct.format(metrics.pct_physical)}%`} />
        <KpiCard label={lang === 'ar' ? 'الأعمال المتبقية' : 'Backlog'} value={contractIsSet ? formatMoney(metrics.backlog) : '-'} />
        <KpiCard label={lang === 'ar' ? 'المستحق' : 'Receivable'} value={formatMoney(metrics.receivable)} tone={metrics.receivable < 0 ? 'danger' : 'positive'} />
        <KpiCard label={lang === 'ar' ? 'الهامش' : 'Margin %'} value={metrics.margin_pct == null ? '-' : `${pct.format(metrics.margin_pct)}%`} tone={toNum(metrics.margin_pct) < 0 ? 'danger' : 'default'} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{lang === 'ar' ? 'التقدم المالي' : 'Financial Progress'}</CardTitle>
          <div className="mt-3"><ProgressBar value={contractIsSet ? metrics.pct_billed : 0} /></div>
          <div className="mt-2 text-xs text-[var(--ds-muted)]">{contractIsSet ? `${pct.format(metrics.pct_billed)}%` : (lang === 'ar' ? 'قيمة العقد غير محددة' : 'Contract value not set')}</div>
        </Card>
        <Card>
          <CardTitle>{lang === 'ar' ? 'التقدم الفعلي' : 'Physical Progress'}</CardTitle>
          <div className="mt-3"><ProgressBar value={metrics.pct_physical} /></div>
          <div className="mt-2 text-xs text-[var(--ds-muted)]">{pct.format(metrics.pct_physical)}%</div>
        </Card>
      </div>

      <Card className="mt-4 h-[340px]">
        <CardTitle>{lang === 'ar' ? 'منحنى S (تراكمي)' : 'S-Curve (Cumulative)'}</CardTitle>
        <div className="mt-3 h-[270px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueCurve} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8e3f1" />
              <XAxis dataKey="month" stroke="#60748a" fontSize={11} />
              <YAxis stroke="#60748a" fontSize={11} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4ebf3', borderRadius: 10, fontSize: 12 }} formatter={(v) => [formatMoney(v), '']} />
              <Legend />
              <Line type="monotone" dataKey="actual" name={lang === 'ar' ? 'فعلي' : 'Actual'} stroke="#3b82f6" strokeWidth={2.5} dot={false} />
              {effectiveMilestones.length > 0 && <Line type="monotone" dataKey="planned" name={lang === 'ar' ? 'مخطط' : 'Planned'} stroke="#93c5fd" strokeWidth={2.5} dot={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>{lang === 'ar' ? 'الإيرادات (المستخلصات)' : 'Revenue (Client Invoices)'}</CardTitle>
        {invoiceTable.globalError && <div className="mt-2 text-xs font-semibold text-[var(--ds-danger)]">{invoiceTable.globalError}</div>}
        <div className="mt-2">
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
            warningByCell={invoiceTable.warningByCell}
            rowWarnings={{}}
            rowErrors={{}}
            emptyLabel={lang === 'ar' ? 'لا توجد فواتير' : 'No invoices'}
          />
        </div>
      </Card>
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={lang === 'ar' ? 'مفوتر (صافي)' : 'Billed Net'} value={formatMoney(metrics.billed_net)} />
        <KpiCard label={lang === 'ar' ? 'محصل' : 'Collected'} value={formatMoney(metrics.collected)} tone="positive" />
        <KpiCard label={lang === 'ar' ? 'متبقي' : 'Outstanding'} value={formatMoney(metrics.receivable)} tone={metrics.receivable < 0 ? 'danger' : 'default'} />
        <KpiCard label={lang === 'ar' ? 'استقطاع محتجز' : 'Retention Held'} value={formatMoney(metrics.retention_held)} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <DataTable
          columns={[
            { key: 'category', label: lang === 'ar' ? 'الفئة' : 'Category' },
            { key: 'amount', label: lang === 'ar' ? 'المبلغ' : 'Amount', render: (row) => <span className="ds-money">{row.amount}</span> },
          ]}
          rows={costRows}
        />
        <Card className="h-[340px]">
          <CardTitle>{lang === 'ar' ? 'توزيع التكلفة' : 'Cost Distribution'}</CardTitle>
          <div className="mt-3 h-[270px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={costByCategory} dataKey="amount" nameKey="category_name" innerRadius={60} outerRadius={100}>
                  {costByCategory.map((_, i) => <Cell key={i} fill={["#3b82f6", "#93c5fd", "#60a5fa", "#2563eb", "#bfdbfe"][i % 5]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e4ebf3', borderRadius: 10, fontSize: 12 }} formatter={(v) => [formatMoney(v), '']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>{lang === 'ar' ? 'الميزانية مقابل الفعلي' : 'Budget vs Actual'}</CardTitle>
        {budgetVariance.length === 0 ? (
          <div className="mt-2 text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'لا توجد ميزانية محددة - أضف ميزانيات لتفعيل الانحراف.' : 'No budget set - add budgets to enable variance.'}</div>
        ) : (
          <DataTable
            className="mt-3"
            columns={[
              { key: 'category', label: lang === 'ar' ? 'الفئة' : 'Category' },
              { key: 'budget', label: lang === 'ar' ? 'الميزانية' : 'Budget', render: (row) => <span className="ds-money">{row.budget}</span> },
              { key: 'actual', label: lang === 'ar' ? 'الفعلي' : 'Actual', render: (row) => <span className="ds-money">{row.actual}</span> },
              {
                key: 'varianceLabel',
                label: lang === 'ar' ? 'الانحراف' : 'Variance',
                render: (row) => <span className={`ds-money ${row.variance >= 0 ? 'text-[var(--ds-positive)]' : 'text-[var(--ds-danger)]'}`}>{row.varianceLabel}</span>,
              },
            ]}
            rows={varianceRows}
          />
        )}
        <div className="mt-3 text-sm text-[var(--ds-muted)]">
          {lang === 'ar'
            ? `التكاليف غير المخصصة على مستوى الشركة (غير معروضة هنا): ${formatMoney(unallocatedCosts)}`
            : `Unallocated company costs not shown here: ${formatMoney(unallocatedCosts)}`}
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>{lang === 'ar' ? 'الجدول الزمني (Gantt)' : 'Schedule (Gantt)'}</CardTitle>
        {milestoneTable.globalError && <div className="mt-2 text-xs font-semibold text-[var(--ds-danger)]">{milestoneTable.globalError}</div>}

        {useMockMilestones && (
          <div className="mt-2 text-xs font-semibold text-amber-700">
            {lang === 'ar' ? 'تم تحميل بيانات مراحل تجريبية (Mock) للعرض.' : 'Mock milestone data loaded for display.'}
          </div>
        )}

        {milestoneTable.rows.length === 0 ? (
          <div className="mt-3">
            <div className="text-sm text-[var(--ds-muted)]">{lang === 'ar' ? 'لا توجد مراحل بعد.' : 'No milestones yet.'}</div>
            {canEditMilestones && (
              <button className="mt-2 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-accent)] px-3 py-2 text-sm font-semibold text-white" onClick={() => milestoneTable.setOpenAdd(true)}>
                {lang === 'ar' ? 'إضافة أول مرحلة' : 'Add first milestone'}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-3">
              <EditableTable
                title={lang === 'ar' ? 'المراحل' : 'Milestones'}
                lang={lang}
                columns={milestoneColumns}
                rows={milestoneTable.rows}
                canEdit={canEditMilestones}
                onChangeCell={milestoneTable.onChangeCell}
                onDeleteRow={milestoneTable.deleteRow}
                onOpenAdd={() => milestoneTable.setOpenAdd(true)}
                statusByCell={milestoneTable.statusByCell}
                warningByCell={milestoneTable.warningByCell}
                rowWarnings={{}}
                rowErrors={{}}
                emptyLabel={lang === 'ar' ? 'لا توجد مراحل' : 'No milestones'}
              />
            </div>
            <Card className="mt-3">
              <ProjectGantt rows={milestoneTable.rows} lang={lang} />
            </Card>
          </>
        )}
      </Card>

      <RecordFormModal
        open={milestoneTable.openAdd && canEditMilestones}
        title={lang === 'ar' ? 'إضافة مرحلة' : 'Add Milestone'}
        columns={milestoneColumns}
        initialValues={{}}
        submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
        onClose={() => milestoneTable.setOpenAdd(false)}
        onSubmit={milestoneTable.addRow}
        lang={lang}
      />

      <div className="mt-3 text-xs text-[var(--ds-muted)]">
        {lang === 'ar' ? 'ملاحظة: العرض قابل للتحرير للمسؤولين فقط.' : 'Note: editing is available to admins only.'}
      </div>
    </div>
  )
}
