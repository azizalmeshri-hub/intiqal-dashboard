import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { projects as fallbackProjects } from '../data/projects'
import {
  buildEmployeeExpirySummary,
  buildExpiringDocumentsList,
  EXPIRY_MONITOR_DOC_TYPES,
  formatEmployeeName,
  getExpiryStatusMeta,
} from '../lib/employees'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import KpiCard from '../components/ui/KpiCard'
import StatusPill from '../components/ui/StatusPill'
import ProgressBar from '../components/ui/ProgressBar'
import AttentionPanel from '../components/ui/AttentionPanel'
import { Card, CardSubtitle, CardTitle } from '../components/ui/Card'

const SANITY = {
  ajdanBilledNet: 8094055,
  ajdanCollected: 7785981,
  totalAr: 1383877,
  totalAp: 4247865,
}

const inRange = (value, expected, tolerancePct = 0.05) => {
  const delta = Math.abs(value - expected)
  return delta <= Math.abs(expected) * tolerancePct
}

function computeFallbackOverview() {
  const list = [fallbackProjects.sadra, fallbackProjects.ajdan]

  const rows = list.map((p) => {
    if (p.id === 'ajdan') {
      const billedNet = p.clientLedgerSummary.totalInvoiced || 0
      const collected = p.clientLedgerSummary.totalReceived || 0
      const receivable = p.clientLedgerSummary.outstanding || 0
      const contractValue = p.contractValue || 0
      return {
        id: p.id,
        name_ar: p.name_ar,
        name_en: p.name_en,
        status: 'active',
        contract_value_net: contractValue,
        physical_pct: p.percentComplete || 0,
        billed_net: billedNet,
        collected,
        receivable,
      }
    }

    const billedNet = p.clientLedgers.reduce((sum, item) => sum + (item.outstanding || 0), 0)
    const receivable = billedNet
    return {
      id: p.id,
      name_ar: p.name_ar,
      name_en: p.name_en,
      status: 'active',
      contract_value_net: p.contractValue || p.contractValuePlaceholder || 0,
      physical_pct: p.percentComplete || 0,
      billed_net: billedNet,
      collected: 0,
      receivable,
    }
  })

  const totalAR = rows.reduce((sum, r) => sum + r.receivable, 0)
  const totalAP = fallbackProjects.ajdan.suppliersContractors
    .reduce((sum, item) => sum + (item.weOwe || 0), 0) + (fallbackProjects.sadra.contractorPayable?.outstanding || 0)

  return {
    rows,
    totals: {
      totalAR,
      totalAP,
      netPosition: totalAR - totalAP,
      totalContractValue: rows.reduce((sum, r) => sum + (r.contract_value_net || 0), 0),
    },
    sanity: {
      matched: false,
      details: 'Fallback mode (local static data).',
    },
  }
}

export default function Overview() {
  const { lang } = useLang()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(null)
  const [employeeMonitor, setEmployeeMonitor] = useState({ summary: null, items: [] })
  const [refreshTick, setRefreshTick] = useState(0)
  const [profileName, setProfileName] = useState('')

  useEffect(() => {
    const handleRefresh = () => setRefreshTick((v) => v + 1)
    window.addEventListener('intiqal:data-changed', handleRefresh)
    return () => window.removeEventListener('intiqal:data-changed', handleRefresh)
  }, [])

  useEffect(() => {
    let active = true

    const loadName = async () => {
      if (!user?.id) {
        setProfileName('')
        return
      }

      const metadata = user.user_metadata || {}
      const fallbackName = lang === 'ar'
        ? (metadata.name_ar || metadata.full_name || metadata.name)
        : (metadata.name_en || metadata.full_name || metadata.name)

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (!active) return

      const localizedProfileName = lang === 'ar'
        ? (data?.name_ar || data?.full_name || data?.name)
        : (data?.name_en || data?.full_name || data?.name)

      setProfileName(localizedProfileName || fallbackName || '')
    }

    loadName()
    return () => { active = false }
  }, [user, lang])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')

      try {
        const { data: projectsData, error: projectsError } = await supabase
          .from('projects')
          .select('id, name_ar, name_en, status, contract_value_net, vat_rate, advance_pct, retention_pct, physical_pct')
          .order('name_en', { ascending: true })

        if (projectsError) throw projectsError

        const { data: invoices, error: invoiceError } = await supabase
          .from('client_invoices')
          .select('id, project_id, amount_net, vat_amount, retention_amount, amount_gross, status, deleted_at')
          .is('deleted_at', null)

        if (invoiceError) throw invoiceError

        const { data: payments, error: paymentError } = await supabase
          .from('client_payments')
          .select('id, project_id, amount, deleted_at')
          .is('deleted_at', null)

        if (paymentError) throw paymentError

        const { data: supplierInvoices, error: supplierError } = await supabase
          .from('supplier_invoices')
          .select('id, project_id, amount_gross, deleted_at')
          .is('deleted_at', null)

        if (supplierError) throw supplierError

        const [employeesRes, employeeDocsRes] = await Promise.all([
          supabase.from('employees').select('id,name_ar,name_en,deleted_at').is('deleted_at', null),
          supabase.from('employee_documents').select('id,employee_id,doc_type,expiry_date'),
        ])

        const employees = employeesRes.data || []
        const employeeDocs = employeeDocsRes.data || []

        const billedByProject = new Map()
        const grossLessRetentionByProject = new Map()
        const collectedByProject = new Map()

        for (const inv of invoices || []) {
          const projectId = inv.project_id
          const amountNet = Number(inv.amount_net || 0)
          const amountGross = Number(inv.amount_gross || 0)
          const retention = Number(inv.retention_amount || 0)

          billedByProject.set(projectId, (billedByProject.get(projectId) || 0) + amountNet)
          grossLessRetentionByProject.set(projectId, (grossLessRetentionByProject.get(projectId) || 0) + (amountGross - retention))
        }

        for (const pay of payments || []) {
          const projectId = pay.project_id
          const amount = Number(pay.amount || 0)
          collectedByProject.set(projectId, (collectedByProject.get(projectId) || 0) + amount)
        }

        const rows = (projectsData || []).map((project) => {
          const billed_net = billedByProject.get(project.id) || 0
          const collected = collectedByProject.get(project.id) || 0
          const receivable = (grossLessRetentionByProject.get(project.id) || 0) - collected
          const contract = Number(project.contract_value_net || 0)
          const pct_billed = contract > 0 ? (billed_net / contract) * 100 : null

          return {
            ...project,
            billed_net,
            collected,
            receivable,
            pct_billed,
          }
        })

        const totalAR = rows.reduce((sum, r) => sum + r.receivable, 0)
        const totalAP = (supplierInvoices || []).reduce((sum, inv) => sum + Number(inv.amount_gross || 0), 0)
        const netPosition = totalAR - totalAP
        const totalContractValue = rows.reduce((sum, r) => sum + Number(r.contract_value_net || 0), 0)

        const ajdan = rows.find((r) => /ajdan|أجدان/i.test(`${r.name_en || ''} ${r.name_ar || ''}`))
        const ajdanBilledNet = ajdan?.billed_net ?? 0
        const ajdanCollected = ajdan?.collected ?? 0

        const sanityMatched =
          inRange(ajdanBilledNet, SANITY.ajdanBilledNet) &&
          inRange(ajdanCollected, SANITY.ajdanCollected) &&
          inRange(totalAR, SANITY.totalAr) &&
          inRange(totalAP, SANITY.totalAp)

        const sanityDetails = sanityMatched
          ? (lang === 'ar' ? 'نتائج المطابقة منطقية مع الأرقام المرجعية.' : 'Sanity check matches expected reference values.')
          : (lang === 'ar'
            ? `تحذير: تحقق المطابقة لم يطابق القيم المرجعية. Ajdan billed=${Math.round(ajdanBilledNet)}, collected=${Math.round(ajdanCollected)}, AR=${Math.round(totalAR)}, AP=${Math.round(totalAP)}`
            : `Warning: sanity check mismatch. Ajdan billed=${Math.round(ajdanBilledNet)}, collected=${Math.round(ajdanCollected)}, AR=${Math.round(totalAR)}, AP=${Math.round(totalAP)}`)

        if (active) {
          setLive({
            rows,
            totals: { totalAR, totalAP, netPosition, totalContractValue },
            sanity: { matched: sanityMatched, details: sanityDetails },
          })

          const employeesById = Object.fromEntries(employees.map((row) => [row.id, row]))
          const summary = buildEmployeeExpirySummary(employeeDocs, { docTypes: EXPIRY_MONITOR_DOC_TYPES })
          const items = buildExpiringDocumentsList(employeeDocs, employeesById, {}, lang, { docTypes: EXPIRY_MONITOR_DOC_TYPES })
            .slice(0, 5)
            .map((item) => ({
              ...item,
              employeeName: formatEmployeeName(employeesById[item.employee_id], lang),
              statusMeta: getExpiryStatusMeta(item.daysToExpiry, lang),
            }))
          setEmployeeMonitor({ summary, items })
        }
      } catch (err) {
        console.error('Overview live data load failed:', err)
        if (active) {
          setError(err?.message || 'Failed to load live data')
          setLive(computeFallbackOverview())
          setEmployeeMonitor({ summary: buildEmployeeExpirySummary([]), items: [] })
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [lang, refreshTick])

  const rows = live?.rows || []
  const totals = live?.totals || { totalAR: 0, totalAP: 0, netPosition: 0, totalContractValue: 0 }
  const docSummary = employeeMonitor.summary || { expired: 0, critical: 0, warning: 0 }

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }), [])

  const dateLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date()), [lang])

  const totalBacklog = useMemo(
    () => rows.reduce((sum, r) => sum + Math.max(Number(r.contract_value_net || 0) - Number(r.billed_net || 0), 0), 0),
    [rows],
  )

  const projectsForCards = useMemo(() => {
    const picked = rows.filter((r) => /ajdan|أجدان|sadra|سدرة/i.test(`${r.name_en || ''} ${r.name_ar || ''}`))
    if (picked.length) return picked
    return rows.slice(0, 2)
  }, [rows])

  const attentionItems = useMemo(() => {
    const items = []
    if (totals.totalAP > totals.totalAR) {
      const delta = totals.totalAP - totals.totalAR
      items.push({
        id: 'payables-over-ar',
        href: '/ledger',
        title: lang === 'ar'
          ? `المطلوبات أعلى من المقبوضات بمقدار ${money.format(delta)} ر.س`
          : `Payables exceed receivables by ${money.format(delta)} SAR`,
        description: lang === 'ar' ? 'راجع الذمم المستحقة للموردين والمقاولين.' : 'Review supplier and contractor obligations.',
      })
    }

    const expiringCount = Number(docSummary.expired || 0) + Number(docSummary.critical || 0) + Number(docSummary.warning || 0)
    if (expiringCount > 0) {
      items.push({
        id: 'employee-docs-expiring',
        href: '/employees',
        title: lang === 'ar'
          ? `يوجد ${expiringCount} مستندات تنتهي خلال 90 يومًا`
          : `${expiringCount} documents expiring within 90 days`,
        description: lang === 'ar' ? 'تحقق من الإقامات وتصاريح العمل لتجنب التعطل.' : 'Check iqama and work permit renewals to prevent interruptions.',
      })
    }

    const sadra = rows.find((r) => /sadra|سدرة/i.test(`${r.name_en || ''} ${r.name_ar || ''}`))
    if (sadra && Number(sadra.contract_value_net || 0) <= 0) {
      items.push({
        id: 'sadra-contract-missing',
        href: `/project/${sadra.id}`,
        title: lang === 'ar' ? 'قيمة عقد سدرة غير محددة' : 'Sadra contract value not set',
        description: lang === 'ar' ? 'أضف قيمة العقد الصافية لإكمال لوحة المتابعة.' : 'Set the net contract value to complete dashboard tracking.',
      })
    }

    return items
  }, [docSummary, lang, money, rows, totals.totalAP, totals.totalAR])

  const nowHour = new Date().getHours()
  const greetPrefix = lang === 'ar'
    ? (nowHour < 12 ? 'صباح الخير' : nowHour < 18 ? 'مساء الخير' : 'مساء الخير')
    : (nowHour < 12 ? 'Good morning' : nowHour < 18 ? 'Good afternoon' : 'Good evening')

  const resolvedName = profileName || (lang === 'ar' ? 'فريق انتقال' : 'Intiqal Team')

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <CardTitle>{lang === 'ar' ? 'تحميل البيانات المباشرة...' : 'Loading live data...'}</CardTitle>
          <CardSubtitle>{lang === 'ar' ? 'يتم تجهيز نظرة عامة محدثة.' : 'Preparing a fresh overview for you.'}</CardSubtitle>
        </Card>
      </div>
    )
  }

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />

      <PageHeader
        title={`${greetPrefix}${resolvedName ? `, ${resolvedName}` : ''}`}
        dateText={dateLabel}
        subtitle={lang === 'ar' ? 'جميع الأرقام أدناه بعملة الريال السعودي (SAR).' : 'All figures below are shown in Saudi Riyal (SAR).'}
      />

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">
            {lang === 'ar'
              ? 'تعذر تحميل البيانات المباشرة، تم استخدام النسخة الاحتياطية المحلية.'
              : 'Live data failed; showing local fallback.'}
          </div>
          <div className="mt-1 text-xs text-red-600">{error}</div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[var(--ds-text)]">{lang === 'ar' ? 'فحص المطابقة' : 'Sanity Check'}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${live?.sanity?.matched ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {live?.sanity?.matched ? (lang === 'ar' ? 'مطابق' : 'Matched') : (lang === 'ar' ? 'تحقق مطلوب' : 'Needs review')}
          </span>
        </div>
        <div className="mt-2 text-sm text-[var(--ds-muted)]">{live?.sanity?.details}</div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={lang === 'ar' ? 'الذمم المدينة (AR)' : 'Receivables (AR)'}
          value={`${money.format(totals.totalAR)} SAR`}
          tone="positive"
        />
        <KpiCard
          label={lang === 'ar' ? 'الذمم الدائنة (AP)' : 'Payables (AP)'}
          value={`${money.format(totals.totalAP)} SAR`}
        />
        <KpiCard
          label={lang === 'ar' ? 'المركز الصافي' : 'Net Position'}
          value={`${money.format(totals.netPosition)} SAR`}
          tone={totals.netPosition < 0 ? 'danger' : 'positive'}
          trend={totals.netPosition < 0 ? 'down' : 'up'}
        />
        <KpiCard
          label={lang === 'ar' ? 'الأعمال المتبقية (Backlog)' : 'Backlog'}
          value={`${money.format(totalBacklog)} SAR`}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {projectsForCards.map((row) => (
            <Link key={row.id} to={`/project/${row.id}`} className="block no-underline">
              <Card className="transition hover:border-[var(--ds-accent)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>{lang === 'ar' ? (row.name_ar || row.name_en) : (row.name_en || row.name_ar)}</CardTitle>
                    <CardSubtitle>{lang === 'ar' ? 'عرض تفصيلي للمشروع' : 'Project deep-dive view'}</CardSubtitle>
                  </div>
                  <StatusPill status={row.status} percent={row.physical_pct} lang={lang} />
                </div>

                <div className="mt-4">
                  <ProgressBar value={row.physical_pct || 0} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="ds-card-soft p-3">
                    <div className="text-xs text-[var(--ds-muted)]">{lang === 'ar' ? 'قيمة العقد' : 'Contract'}</div>
                    <div className="ds-money mt-1 text-base font-bold text-[var(--ds-text)]">{money.format(Number(row.contract_value_net || 0))} SAR</div>
                  </div>
                  <div className="ds-card-soft p-3">
                    <div className="text-xs text-[var(--ds-muted)]">{lang === 'ar' ? 'المحصل' : 'Collected'}</div>
                    <div className="ds-money mt-1 text-base font-bold text-[var(--ds-positive)]">{money.format(Number(row.collected || 0))} SAR</div>
                  </div>
                  <div className="ds-card-soft p-3">
                    <div className="text-xs text-[var(--ds-muted)]">{lang === 'ar' ? 'المتبقي (AR)' : 'Receivable'}</div>
                    <div className={`ds-money mt-1 text-base font-bold ${Number(row.receivable || 0) < 0 ? 'text-[var(--ds-danger)]' : 'text-[var(--ds-text)]'}`}>
                      {money.format(Number(row.receivable || 0))} SAR
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="lg:col-span-4">
          <AttentionPanel
            title={lang === 'ar' ? 'يتطلب الانتباه' : 'Needs Attention'}
            subtitle={lang === 'ar' ? 'تنبيهات حية من بيانات المشروع والموظفين' : 'Live alerts from project and employee data'}
            items={attentionItems}
            emptyText={lang === 'ar' ? 'لا توجد تنبيهات حرجة حاليًا.' : 'No critical alerts right now.'}
          />
        </div>
      </div>

      {employeeMonitor.items?.length ? (
        <Card className="mt-4">
          <CardTitle>{lang === 'ar' ? 'تنبيهات الوثائق القريبة' : 'Upcoming Document Alerts'}</CardTitle>
          <div className="mt-3 space-y-2">
            {employeeMonitor.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-soft)] px-3 py-2 text-sm">
                <span>
                  {item.employeeName} - {item.docTypeLabel}
                </span>
                <span className={`text-xs font-semibold ${item.statusMeta.key === 'expired' ? 'text-[var(--ds-danger)]' : item.statusMeta.key === 'critical' ? 'text-amber-700' : 'text-[var(--ds-muted)]'}`}>
                  {item.statusMeta.label}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
