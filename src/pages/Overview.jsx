import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import ExpiryMonitorPanel from '../components/ExpiryMonitorPanel'
import { supabase } from '../lib/supabase'
import { projects as fallbackProjects } from '../data/projects'
import {
  buildEmployeeExpirySummary,
  buildExpiringDocumentsList,
  EXPIRY_MONITOR_DOC_TYPES,
  formatEmployeeName,
  getExpiryStatusMeta,
} from '../lib/employees'

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
  const { t, lang } = useLang()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(null)
  const [employeeMonitor, setEmployeeMonitor] = useState({ summary: null, items: [] })
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const handleRefresh = () => setRefreshTick((v) => v + 1)
    window.addEventListener('intiqal:data-changed', handleRefresh)
    return () => window.removeEventListener('intiqal:data-changed', handleRefresh)
  }, [])

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

  const activeProjectsCount = useMemo(
    () => rows.filter((r) => ['planning', 'active', 'on_hold'].includes(r.status)).length,
    [rows],
  )

  if (loading) {
    return (
      <div className="card">
        <div className="card-label">{lang === 'ar' ? 'تحميل البيانات المباشرة...' : 'Loading live data...'}</div>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>
            {lang === 'ar' ? 'تعذر تحميل البيانات المباشرة، تم استخدام النسخة الاحتياطية المحلية.' : 'Live data failed; showing local fallback.'}
          </div>
          <div className="card-sub">{error}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-label">{lang === 'ar' ? 'فحص المطابقة' : 'Sanity Check'}</div>
        <div className="card-sub" style={{ color: live?.sanity?.matched ? 'var(--green)' : 'var(--amber)' }}>
          {live?.sanity?.details}
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label={t('total_contracts')} value={totals.totalContractValue} />
        <StatCard label={t('total_receivable')} value={totals.totalAR} />
        <StatCard label={t('total_payable')} value={totals.totalAP} />
        <StatCard label={t('net_position')} value={totals.netPosition} />
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <StatCard label={t('active_projects')} value={activeProjectsCount} />
        <StatCard label={lang === 'ar' ? 'إجمالي المشاريع' : 'Total Projects'} value={rows.length} />
        <StatCard label={lang === 'ar' ? 'الحسابات المدينة (AR)' : 'Accounts Receivable (AR)'} value={totals.totalAR} />
        <StatCard label={lang === 'ar' ? 'الحسابات الدائنة (AP)' : 'Accounts Payable (AP)'} value={totals.totalAP} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ExpiryMonitorPanel
          lang={lang}
          title={lang === 'ar' ? 'تنبيهات إقامات وتصاريح العمل' : 'Iqama & Work-Permit Alerts'}
          summary={employeeMonitor.summary}
          items={employeeMonitor.items}
          emptyLabel={lang === 'ar' ? 'لا توجد مستندات موظفين منتهية أو على وشك الانتهاء خلال 90 يومًا.' : 'No employee documents are expired or due within 90 days.'}
          compact
        />
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'بطاقات المشاريع' : 'Project Cards'}</h2>
      <div className="grid grid-3">
        {rows.map((row) => (
          <Link key={row.id} to={`/project/${row.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <h3 style={{ margin: 0 }}>{lang === 'ar' ? (row.name_ar || row.name_en) : (row.name_en || row.name_ar)}</h3>
                <span className="tag-note">{row.status || '-'}</span>
              </div>
              <div className="card-sub" style={{ marginTop: 8 }}>{lang === 'ar' ? 'انقر للتفاصيل العميقة' : 'Click for deep-dive'}</div>
              <div className="info-row" style={{ marginTop: 8 }}>
                <span>{lang === 'ar' ? 'المفوتر' : 'Billed'}</span>
                <span className="mono">{Number(row.billed_net || 0).toLocaleString('en-US')} SAR</span>
              </div>
              <div className="info-row">
                <span>{lang === 'ar' ? 'المحصل' : 'Collected'}</span>
                <span className="mono">{Number(row.collected || 0).toLocaleString('en-US')} SAR</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'ملخص المشاريع (بيانات مباشرة)' : 'Projects Summary (Live Data)'}</h2>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
              <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
              <th>{lang === 'ar' ? 'قيمة العقد (صافي)' : 'Contract Value (Net)'}</th>
              <th>{lang === 'ar' ? 'المفوتر (صافي)' : 'Billed Net'}</th>
              <th>{lang === 'ar' ? 'المحصل' : 'Collected'}</th>
              <th>{lang === 'ar' ? 'AR المستحق' : 'Receivable (AR)'}</th>
              <th>{lang === 'ar' ? 'نسبة الفوترة' : 'Pct Billed'}</th>
              <th>{lang === 'ar' ? 'التقدم الفعلي' : 'Physical %'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/project/${row.id}`} style={{ color: 'inherit' }}>
                    {lang === 'ar' ? (row.name_ar || row.name_en) : (row.name_en || row.name_ar)}
                  </Link>
                </td>
                <td>{row.status}</td>
                <td className="num">{Number(row.contract_value_net || 0).toLocaleString('en-US')} SAR</td>
                <td className="num">{row.billed_net.toLocaleString('en-US')} SAR</td>
                <td className="num">{row.collected.toLocaleString('en-US')} SAR</td>
                <td className={`num ${row.receivable >= 0 ? 'pos' : 'neg'}`}>{row.receivable.toLocaleString('en-US')} SAR</td>
                <td className="num">{row.pct_billed == null ? '-' : `${row.pct_billed.toFixed(1)}%`}</td>
                <td className="num">{Number(row.physical_pct || 0).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
