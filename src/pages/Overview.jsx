import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import { projects, companySummary } from '../data/projects'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function Overview() {
  const { t, lang, isRtl } = useLang()
  const { sadra, ajdan } = projects

  const chartData = [
    {
      name: lang === 'ar' ? 'سدرة' : 'Sadra',
      invoiced: (sadra.clientLedgers[0].invoicedTotal || 0),
    },
    {
      name: lang === 'ar' ? 'أجدان' : 'Ajdan',
      invoiced: ajdan.clientLedgerSummary.totalInvoiced,
    },
  ]

  const totalContractValue = (ajdan.contractValue || 0) + (sadra.contractValuePlaceholder || 0)

  return (
    <div>
      <div className="grid grid-4">
        <StatCard label={t('total_contracts')} value={totalContractValue} sub={t('placeholder_notice')} />
        <StatCard label={t('total_receivable')} value={companySummary.totalReceivableFromClients} />
        <StatCard label={t('active_projects')} value={2} />
        <StatCard label={t('net_income_est')} value={
          companySummary.totalReceivableFromClients - companySummary.totalPayableToSuppliers
        } sub={t('overhead_pending')} />
      </div>

      <h2 className="section-title">{t('project_health')}</h2>
      <div className="grid grid-2">
        <Link to="/sadra" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3>{lang === 'ar' ? sadra.name_ar : sadra.name_en}</h3>
              <StatusBadge status={sadra.status} />
            </div>
            <TapeProgress percent={sadra.percentComplete} />
            <div className="card-sub" style={{ marginTop: 10 }}>
              {lang === 'ar' ? sadra.location_ar : sadra.location_en}
            </div>
          </div>
        </Link>
        <Link to="/ajdan" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3>{lang === 'ar' ? ajdan.name_ar : ajdan.name_en}</h3>
              <StatusBadge status={ajdan.status} />
            </div>
            <TapeProgress percent={Math.min(ajdan.percentComplete, 100)} />
            <div className="card-sub" style={{ marginTop: 10 }}>
              {lang === 'ar' ? ajdan.location_ar : ajdan.location_en}
            </div>
          </div>
        </Link>
      </div>

      <h2 className="section-title">{t('invoiced')}</h2>
      <div className="card" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout={isRtl ? undefined : undefined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
            <XAxis dataKey="name" stroke="#8fa3b3" fontSize={12} />
            <YAxis stroke="#8fa3b3" fontSize={11} />
            <Tooltip
              contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8 }}
              formatter={(v) => v.toLocaleString('en-US')}
            />
            <Bar dataKey="invoiced" fill="#e8a33d" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
