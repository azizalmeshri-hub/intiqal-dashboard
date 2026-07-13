const DAY_MS = 24 * 60 * 60 * 1000

export const AGING_BUCKETS = [
  '0-30',
  '31-60',
  '61-90',
  '91-120',
  '121-180',
  '>180',
  'No due date',
]

function toNumber(value) {
  const num = Number(value || 0)
  return Number.isFinite(num) ? num : 0
}

function toTime(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function monthKey(value) {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}`
}

function sumBy(rows, getValue) {
  return (rows || []).reduce((sum, row) => sum + toNumber(getValue(row)), 0)
}

export function calcAR(clientInvoices, clientPayments) {
  const invoicedLessRetention = sumBy(clientInvoices, (row) => toNumber(row.amount_gross) - toNumber(row.retention_amount))
  const paid = sumBy(clientPayments, (row) => row.amount)
  return invoicedLessRetention - paid
}

export function calcAP(supplierInvoices, supplierPayments) {
  const invoiced = sumBy(supplierInvoices, (row) => row.amount_gross)
  const paid = sumBy(supplierPayments, (row) => row.amount)
  return invoiced - paid
}

export function calcRetentionReceivable(clientInvoices) {
  return sumBy(clientInvoices, (row) => row.retention_amount)
}

export function calcNetPosition(ar, ap) {
  return toNumber(ar) - toNumber(ap)
}

export function calcCollectionRate(clientInvoices, clientPayments) {
  const denominator = sumBy(clientInvoices, (row) => toNumber(row.amount_gross) - toNumber(row.retention_amount))
  if (denominator <= 0) return 0
  const paid = sumBy(clientPayments, (row) => row.amount)
  return paid / denominator
}

export function calcBacklog(projects, clientInvoices) {
  const billedByProject = new Map()
  for (const row of clientInvoices || []) {
    const projectId = row.project_id
    billedByProject.set(projectId, (billedByProject.get(projectId) || 0) + toNumber(row.amount_net))
  }

  let total = 0
  let unknownCount = 0

  const rows = (projects || []).map((project) => {
    const contractValue = toNumber(project.contract_value_net)
    const billedNet = billedByProject.get(project.id) || 0

    if (contractValue <= 0) {
      unknownCount += 1
      return {
        project_id: project.id,
        billed_net: billedNet,
        backlog: null,
        is_unknown: true,
      }
    }

    const backlog = Math.max(contractValue - billedNet, 0)
    total += backlog

    return {
      project_id: project.id,
      billed_net: billedNet,
      backlog,
      is_unknown: false,
    }
  })

  return {
    total,
    unknownCount,
    rows,
  }
}

function bucketByAgeDays(ageDays) {
  if (ageDays <= 30) return '0-30'
  if (ageDays <= 60) return '31-60'
  if (ageDays <= 90) return '61-90'
  if (ageDays <= 120) return '91-120'
  if (ageDays <= 180) return '121-180'
  return '>180'
}

export function buildOpenItems({ invoices, payments, invoiceAmountKey, invoiceIdKey, paymentInvoiceIdKey, dueDateKey }) {
  const paidByInvoice = new Map()

  for (const pay of payments || []) {
    const invoiceId = pay[paymentInvoiceIdKey]
    if (!invoiceId) continue
    paidByInvoice.set(invoiceId, (paidByInvoice.get(invoiceId) || 0) + toNumber(pay.amount))
  }

  return (invoices || [])
    .map((inv) => {
      const id = inv[invoiceIdKey]
      const gross = toNumber(inv[invoiceAmountKey])
      const paid = paidByInvoice.get(id) || 0
      const open = Math.max(gross - paid, 0)
      return {
        ...inv,
        open_amount: open,
        due_date: inv[dueDateKey],
      }
    })
    .filter((row) => row.open_amount > 0)
}

export function calcAging(openItems, today = new Date()) {
  const now = today.getTime()
  const totals = {
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '91-120': 0,
    '121-180': 0,
    '>180': 0,
    'No due date': 0,
  }

  for (const row of openItems || []) {
    const dueTime = toTime(row.due_date)
    if (dueTime == null) {
      totals['No due date'] += toNumber(row.open_amount)
      continue
    }

    const ageDays = Math.max(Math.floor((now - dueTime) / DAY_MS), 0)
    const bucket = bucketByAgeDays(ageDays)
    totals[bucket] += toNumber(row.open_amount)
  }

  const rows = AGING_BUCKETS.map((bucket) => ({
    bucket,
    amount: totals[bucket] || 0,
  }))

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
  }
}

export function calcCashFlowByMonth(cashInRows, cashOutRows) {
  const byMonth = new Map()

  for (const row of cashInRows || []) {
    const key = monthKey(row.payment_date)
    if (!key) continue
    const current = byMonth.get(key) || { month: key, cashIn: 0, cashOut: 0 }
    current.cashIn += toNumber(row.amount)
    byMonth.set(key, current)
  }

  for (const row of cashOutRows || []) {
    const key = monthKey(row.payment_date)
    if (!key) continue
    const current = byMonth.get(key) || { month: key, cashIn: 0, cashOut: 0 }
    current.cashOut += toNumber(row.amount)
    byMonth.set(key, current)
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month))
}

export function calcSupplierConcentration(openSupplierItems, supplierNames = {}, topN = 5) {
  const totalsBySupplier = new Map()

  for (const row of openSupplierItems || []) {
    const supplierId = row.supplier_id || 'unknown'
    totalsBySupplier.set(supplierId, (totalsBySupplier.get(supplierId) || 0) + toNumber(row.open_amount))
  }

  const sorted = Array.from(totalsBySupplier.entries())
    .map(([supplierId, amount]) => ({
      supplier_id: supplierId,
      name: supplierNames[supplierId] || supplierId,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount)

  if (sorted.length <= topN) return sorted

  const head = sorted.slice(0, topN)
  const tailTotal = sorted.slice(topN).reduce((sum, row) => sum + row.amount, 0)

  if (tailTotal > 0) {
    head.push({ supplier_id: 'others', name: 'Others', amount: tailTotal })
  }

  return head
}

export function calcProjectProfitability(projects, clientInvoices, supplierInvoices) {
  const billedByProject = new Map()
  const costByProject = new Map()

  for (const row of clientInvoices || []) {
    const projectId = row.project_id || null
    billedByProject.set(projectId, (billedByProject.get(projectId) || 0) + toNumber(row.amount_net))
  }

  for (const row of supplierInvoices || []) {
    const projectId = row.project_id || null
    costByProject.set(projectId, (costByProject.get(projectId) || 0) + toNumber(row.amount_net))
  }

  const rows = (projects || []).map((project) => {
    const billedNet = billedByProject.get(project.id) || 0
    const costToDate = costByProject.get(project.id) || 0
    const grossProfit = billedNet - costToDate
    const marginPct = billedNet > 0 ? (grossProfit / billedNet) * 100 : null

    return {
      project_id: project.id,
      billed_net: billedNet,
      cost_to_date: costToDate,
      gross_profit: grossProfit,
      margin_pct: marginPct,
    }
  })

  const unallocatedCost = costByProject.get(null) || 0
  rows.push({
    project_id: 'unallocated',
    billed_net: 0,
    cost_to_date: unallocatedCost,
    gross_profit: -unallocatedCost,
    margin_pct: null,
    is_unallocated: true,
  })

  return rows
}

export function calcNextFourWeeks(openItems, today = new Date()) {
  const now = today.getTime()
  const horizon = now + (28 * DAY_MS)

  return (openItems || []).reduce((sum, row) => {
    const dueTime = toTime(row.due_date)
    if (dueTime == null) return sum
    if (dueTime < now || dueTime > horizon) return sum
    return sum + toNumber(row.open_amount)
  }, 0)
}

export function calcProjectDeepDiveMetrics(project, clientInvoices, clientPayments, supplierInvoices) {
  const contractValue = toNumber(project?.contract_value_net)
  const billedNet = sumBy(clientInvoices, (row) => row.amount_net)
  const collected = sumBy(clientPayments, (row) => row.amount)
  const receivable = calcAR(clientInvoices, clientPayments)
  const retentionHeld = calcRetentionReceivable(clientInvoices)
  const costToDate = sumBy(supplierInvoices, (row) => row.amount_net)
  const grossProfit = billedNet - costToDate

  return {
    billed_net: billedNet,
    collected,
    pct_billed: contractValue > 0 ? (billedNet / contractValue) * 100 : null,
    backlog: contractValue > 0 ? Math.max(contractValue - billedNet, 0) : null,
    receivable,
    retention_held: retentionHeld,
    cost_to_date: costToDate,
    gross_profit: grossProfit,
    margin_pct: billedNet > 0 ? (grossProfit / billedNet) * 100 : null,
    pct_physical: toNumber(project?.physical_pct),
  }
}

export function buildActualRevenueCurve(clientInvoices) {
  const monthMap = new Map()

  for (const row of clientInvoices || []) {
    const key = monthKey(row.invoice_date)
    if (!key) continue
    monthMap.set(key, (monthMap.get(key) || 0) + toNumber(row.amount_net))
  }

  let cumulative = 0
  return Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => {
      cumulative += amount
      return { month, actual: cumulative }
    })
}

export function buildPlannedRevenueCurve(milestones, contractValueNet, billedNetFallback = 0) {
  const sorted = [...(milestones || [])]
    .filter((m) => m?.end_date)
    .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)))

  if (!sorted.length) return []

  const totalWeight = sorted.reduce((sum, row) => sum + Math.max(toNumber(row.weight), 0), 0)
  if (totalWeight <= 0) return []

  const base = toNumber(contractValueNet) > 0 ? toNumber(contractValueNet) : toNumber(billedNetFallback)
  let cumulative = 0

  return sorted.map((row) => {
    const ratio = Math.max(toNumber(row.weight), 0) / totalWeight
    cumulative += base * ratio
    return {
      month: monthKey(row.end_date) || row.end_date,
      planned: cumulative,
    }
  })
}

export function mergeRevenueCurves(actualRows, plannedRows) {
  const byMonth = new Map()

  for (const row of plannedRows || []) {
    const current = byMonth.get(row.month) || { month: row.month, actual: null, planned: null }
    current.planned = row.planned
    byMonth.set(row.month, current)
  }

  for (const row of actualRows || []) {
    const current = byMonth.get(row.month) || { month: row.month, actual: null, planned: null }
    current.actual = row.actual
    byMonth.set(row.month, current)
  }

  let lastActual = null
  let lastPlanned = null
  return Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => {
      if (row.actual == null) row.actual = lastActual
      else lastActual = row.actual
      if (row.planned == null) row.planned = lastPlanned
      else lastPlanned = row.planned
      return row
    })
}

export function calcCostByCategory(supplierInvoices, categoryNameById = {}) {
  const byCategory = new Map()

  for (const row of supplierInvoices || []) {
    const categoryId = row.cost_category_id || 'uncategorized'
    const key = String(categoryId)
    const name = categoryNameById[key] || (key === 'uncategorized' ? 'Uncategorized' : key)
    byCategory.set(key, {
      category_id: key,
      category_name: name,
      amount: (byCategory.get(key)?.amount || 0) + toNumber(row.amount_net),
    })
  }

  return Array.from(byCategory.values()).sort((a, b) => b.amount - a.amount)
}

export function calcBudgetVariance(projectBudgets, actualCostsByCategory) {
  const actualById = new Map((actualCostsByCategory || []).map((row) => [String(row.category_id), toNumber(row.amount)]))

  return (projectBudgets || []).map((row) => {
    const categoryId = String(row.cost_category_id || 'uncategorized')
    const budget = toNumber(row.amount ?? row.budget_amount ?? row.value)
    const actual = actualById.get(categoryId) || 0
    return {
      category_id: categoryId,
      category_name: row.category_name || row.name || categoryId,
      budget,
      actual,
      variance: budget - actual,
    }
  })
}
