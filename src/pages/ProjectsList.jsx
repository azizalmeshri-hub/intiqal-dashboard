import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../context/LangContext'
import { supabase } from '../lib/supabase'
import TopNav from '../components/ui/TopNav'
import PageHeader from '../components/ui/PageHeader'
import { Card, CardSubtitle, CardTitle } from '../components/ui/Card'
import StatusPill from '../components/ui/StatusPill'
import ProgressBar from '../components/ui/ProgressBar'

export default function ProjectsList({ preferred = '' }) {
  const { lang } = useLang()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const { data: projectsData, error: projectsError } = await supabase
          .from('projects')
          .select('id, name_ar, name_en, status, contract_value_net, physical_pct')
          .order('name_en', { ascending: true })

        if (projectsError) throw projectsError

        const { data: invoices, error: invoiceError } = await supabase
          .from('client_invoices')
          .select('project_id, amount_net, retention_amount, amount_gross, deleted_at')
          .is('deleted_at', null)

        if (invoiceError) throw invoiceError

        const { data: payments, error: paymentError } = await supabase
          .from('client_payments')
          .select('project_id, amount, deleted_at')
          .is('deleted_at', null)

        if (paymentError) throw paymentError

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

        const nextRows = (projectsData || []).map((project) => {
          const billed_net = billedByProject.get(project.id) || 0
          const collected = collectedByProject.get(project.id) || 0
          const receivable = (grossLessRetentionByProject.get(project.id) || 0) - collected
          return {
            ...project,
            billed_net,
            collected,
            receivable,
          }
        })

        if (active) setRows(nextRows)
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load projects')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [])

  const money = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }), [])
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date()), [lang])

  const ordered = useMemo(() => {
    if (!preferred) return rows
    const preferredRows = rows.filter((r) => String(r.name_en || '').toLowerCase().includes(preferred.toLowerCase()) || String(r.name_ar || '').includes(preferred))
    const otherRows = rows.filter((r) => !preferredRows.includes(r))
    return [...preferredRows, ...otherRows]
  }, [rows, preferred])

  if (loading) {
    return (
      <div className="ds-root ds-fade-in">
        <TopNav />
        <Card>
          <CardTitle>{lang === 'ar' ? 'تحميل قائمة المشاريع...' : 'Loading projects list...'}</CardTitle>
        </Card>
      </div>
    )
  }

  return (
    <div className="ds-root ds-fade-in">
      <TopNav />
      <PageHeader
        title={lang === 'ar' ? 'قائمة المشاريع' : 'Projects List'}
        dateText={todayLabel}
        subtitle={lang === 'ar' ? 'اختر مشروعًا لعرض التفاصيل العميقة.' : 'Choose a project to open the deep-dive.'}
      />

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {ordered.map((row) => (
          <Link key={row.id} to={`/project/${row.id}`} className="block no-underline">
            <Card className="transition hover:border-[var(--ds-accent)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{lang === 'ar' ? (row.name_ar || row.name_en) : (row.name_en || row.name_ar)}</CardTitle>
                  <CardSubtitle>{lang === 'ar' ? 'انقر للتفاصيل العميقة' : 'Click for deep-dive'}</CardSubtitle>
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
    </div>
  )
}
