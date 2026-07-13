import { scheduleProgressPct } from './schedule'

// Automatic risk flag based on:
// 1. Gap between schedule-expected progress and actual physical/billing progress
// 2. Aging of outstanding receivables/payables (how much is sitting past 60/90 days)
//
// Returns { status: 'on-track' | 'watch' | 'critical', reasons: string[] }
export function computeRisk({ startDate, endDate, today, actualCompletionPct, outstanding, contractValue, lastActivityDate }) {
  const reasons = []
  const expectedPct = scheduleProgressPct(startDate, endDate, today)
  const gap = expectedPct - actualCompletionPct // positive = behind schedule

  const daysSinceActivity = lastActivityDate
    ? Math.floor((today.getTime() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const outstandingRatio = contractValue ? outstanding / contractValue : 0

  let score = 0

  if (gap > 15) { score += 2; reasons.push('schedule_behind_major') }
  else if (gap > 5) { score += 1; reasons.push('schedule_behind_minor') }

  if (daysSinceActivity > 90) { score += 2; reasons.push('aging_90plus') }
  else if (daysSinceActivity > 60) { score += 1; reasons.push('aging_60_90') }

  if (outstandingRatio > 0.15) { score += 1; reasons.push('outstanding_high') }

  let status = 'on-track'
  if (score >= 3) status = 'critical'
  else if (score >= 1) status = 'watch'

  return { status, reasons, expectedPct, gap: Math.round(gap * 10) / 10 }
}

export function agingBucket(dateStr, today) {
  const days = Math.floor((today.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 30) return 'current'
  if (days <= 60) return 'd30'
  if (days <= 90) return 'd60'
  return 'd90plus'
}
