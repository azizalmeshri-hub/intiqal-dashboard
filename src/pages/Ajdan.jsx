import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import { projects } from '../data/projects'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function Ajdan() {
  const { t, lang } = useLang()
  const p = projects.ajdan

  const pieData = [
    { name: lang === 'ar' ? 'محصل' : 'Received', value: p.clientLedgerSummary.totalReceived },
    { name: lang === 'ar' ? 'متبقي' : 'Outstanding', value: p.clientLedgerSummary.outstanding },
  ]
  const colors = ['#4f9d6e', '#e8a33d']

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 className="display">{lang === 'ar' ? p.name_ar : p.name_en}</h1>
        <StatusBadge status={p.status} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="info-row"><span>{t('owner')}</span><span>{lang === 'ar' ? p.owner_ar : p.owner_en}</span></div>
        <div className="info-row"><span>{t('role')}</span><span>{lang === 'ar' ? p.role_ar : p.role_en}</span></div>
        <div className="info-row"><span>{t('location')}</span><span>{lang === 'ar' ? p.location_ar : p.location_en}</span></div>
      </div>

      <h2 className="section-title">{t('completion')}</h2>
      <div className="card">
        <TapeProgress percent={Math.min(p.percentComplete, 100)} />
        <p className="tag-note" style={{ marginTop: 12 }}>
          {lang === 'ar'
            ? 'النسبة محسوبة من (ما تم إنجازه شامل الدفعة المقدمة) ÷ (قيمة العقد) — قد تتجاوز 100% لأنها تشمل الدفعة المقدمة، راجع مع الفريق المالي.'
            : 'Calculated as (work completed incl. advance) ÷ (contract value) — may exceed 100% since it includes the advance payment; confirm with finance.'}
        </p>
      </div>

      <h2 className="section-title">{t('project_summary')}</h2>
      <div className="grid grid-4">
        <StatCard label={t('contract_value')} value={p.contractValue} />
        <StatCard label={lang === 'ar' ? 'الدفعة المقدمة (2.5%)' : 'Advance Payment (2.5%)'} value={p.advancePayment} />
        <StatCard label={lang === 'ar' ? 'المنجز شامل الدفعة المقدمة' : 'Completed incl. Advance'} value={p.completedInclAdvance} />
        <StatCard label={lang === 'ar' ? 'المتبقي من المشروع' : 'Remaining on Contract'} value={p.remainingOnProject} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card side-stack">
          <div className="info-row"><span>{t('timeline')}</span><span>{p.timeline.start} → {p.timeline.end}</span></div>
          <div className="info-row"><span>{t('milestones')}</span><span>{p.timeline.milestone}</span></div>
          <div className="info-row"><span>{t('direct_costs')}</span><span className="mono">{p.finance.directCost.toLocaleString('en-US')} SAR</span></div>
          <div className="info-row"><span>{t('overhead_cost')}</span><span className="mono">{p.finance.overheadCost.toLocaleString('en-US')} SAR</span></div>
        </div>
        <div className="card" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {pieData.map((_, i) => <Cell key={i} fill={colors[i]} />)}
              </Pie>
              <Tooltip formatter={(v) => v.toLocaleString('en-US')} contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8 }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h2 className="section-title">{t('supplier_breakdown')}</h2>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'الجهة' : 'Party'}</th>
              <th>{t('outstanding')}</th>
              <th>{t('entry_type')}</th>
            </tr>
          </thead>
          <tbody>
            {p.suppliersContractors.map((s, i) => (
              <tr key={i}>
                <td>{lang === 'ar' ? s.name_ar : s.name_en}</td>
                <td className={`num ${s.type === 'we_are_owed' ? 'pos' : 'neg'}`}>
                  {(s.outstandingToUs ?? s.weOwe).toLocaleString('en-US')} SAR
                </td>
                <td>{s.type === 'we_are_owed' ? t('receivable') : t('payable')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
