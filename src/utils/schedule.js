// Generates a planned "S-curve" (slow-fast-slow spend/billing profile) between
// a project's start and end date, using a smoothstep function — the standard
// simple approximation used in construction planning when a detailed
// baseline schedule isn't available.

function smoothstep(x) {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

export function monthsBetween(start, end) {
  const s = new Date(start)
  const e = new Date(end)
  const months = []
  const cur = new Date(s.getFullYear(), s.getMonth(), 1)
  const last = new Date(e.getFullYear(), e.getMonth(), 1)
  while (cur <= last) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

// Returns [{ month, plannedPct, actualPct, actualAmount, plannedAmount }]
export function buildSCurve({ startDate, endDate, monthlyBilled, contractValue, today }) {
  const months = monthsBetween(startDate, endDate)
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const span = Math.max(end - start, 1)

  const billedByMonth = Object.fromEntries(monthlyBilled.map((m) => [m.month, m.amount]))
  let cumulativeActual = 0
  const totalActual = monthlyBilled.reduce((a, m) => a + m.amount, 0)

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return months.map((month) => {
    const [y, mo] = month.split('-').map(Number)
    const monthDate = new Date(y, mo - 1, 15).getTime()
    const progress = smoothstep((monthDate - start) / span)
    const plannedPct = progress * 100
    const plannedAmount = contractValue ? contractValue * progress : null

    const billedThisMonth = billedByMonth[month] || 0
    if (month <= todayKey) cumulativeActual += billedThisMonth

    const actualPct = contractValue ? Math.min((cumulativeActual / contractValue) * 100, 999) : null

    return {
      month,
      isFuture: month > todayKey,
      plannedPct: Number(plannedPct.toFixed(1)),
      actualPct: month <= todayKey && contractValue ? Number(actualPct.toFixed(1)) : null,
      plannedAmount,
      cumulativeActual: month <= todayKey ? cumulativeActual : null,
    }
  })
}

export function scheduleProgressPct(startDate, endDate, today) {
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const now = today.getTime()
  const span = Math.max(end - start, 1)
  return Math.round(smoothstep((now - start) / span) * 1000) / 10
}
