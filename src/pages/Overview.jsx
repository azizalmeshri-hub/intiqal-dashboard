import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import { projects, companySummary } from '../data/projects'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'

export default function Overview() {
  const { t, lang, isRtl } = useLang()
  const { sadra, ajdan } = projects

  const chartData = [
    { name: lang === 'ar' ? 'سدرة' : 'Sadra', invoiced: sadra.clientLedgers[0].invoicedTotal || 0 },
    { name: lang === 'ar' ? 'أجدان' : 'Ajdan', invoiced: ajdan.clientLedgerSummary.totalInvoiced },
  ]

  const totalContractValue = (ajdan.contractValue || 0) + (sadra.contractValuePlaceholder || 0)
  const netPosition = companySummary.totalReceivableFromClients - companySummary.totalPayableToSuppliers
  const combinedDirectCost = sadra.finance.directCost + ajdan.finance.directCost
  const combinedIndirectCost = sadra.finance.indirectCost + ajdan.finance.indirectCost
  const combinedOverheadCost = sadra.finance.overheadCost + ajdan.finance.overheadCost
  const companyReceivable = companySummary.totalReceivableFromClients
  const companyPayable = companySummary.totalPayableToSuppliers

  const costMixData = [
    { name: lang === 'ar' ? 'مباشر' : 'Direct', value: combinedDirectCost },
    { name: lang === 'ar' ? 'غير مباشر' : 'Indirect', value: combinedIndirectCost },
    { name: lang === 'ar' ? 'إدارة وتشغيل' : 'Overhead', value: combinedOverheadCost },
  ]

  const costMixColors = ['#e8a33d', '#4f9ef7', '#18b4b9']

  return (
    <div>
      <div className="card hero-panel">
        <div>
          <h1 className="display">{t('executive_summary')}</h1>
          <p className="card-sub" style={{ marginTop: 8, maxWidth: 760, lineHeight: 1.7 }}>
            {lang === 'ar'
              ? 'لوحة قيادة فاخرة للمراقبة اللحظية لصحة المشاريع، التدفقات النقدية، المستحقات، والتكاليف المباشرة وغير المباشرة في شركة انتقال للمقاولات العامة.'
              : 'A refined executive command surface for monitoring project health, cash flow, receivables, and direct versus indirect costs at Intiqal General Contracting.'}
          </p>
        </div>
        <div className="hero-pills">
          <span className="summary-pill">{t('active_projects')} · 2</span>
          <span className="summary-pill">{t('project_health')} · {t('status_on_track')}</span>
          <span className="summary-pill">{t('timeline')} · {lang === 'ar' ? '2026' : '2026'}</span>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label={t('total_contracts')} value={totalContractValue} sub={t('placeholder_notice')} />
        <StatCard label={t('total_receivable')} value={companyReceivable} />
        <StatCard label={t('total_payable')} value={companyPayable} />
        <StatCard label={t('net_income_est')} value={netPosition} sub={t('overhead_pending')} />
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <StatCard label={t('direct_costs')} value={combinedDirectCost} />
        <StatCard label={t('indirect_costs')} value={combinedIndirectCost} />
        <StatCard label={t('overhead_cost')} value={combinedOverheadCost} />
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
            <div className="info-row" style={{ marginTop: 10 }}>
              <span>{t('timeline')}</span>
              <span>{lang === 'ar' ? 'من أغسطس 2024 إلى مارس 2026' : 'Aug 2024 to Mar 2026'}</span>
            </div>
            <div className="info-row">
              <span>{t('project_notes')}</span>
              <span>{lang === 'ar' ? 'أعمال مدنية وبنية تحتية على مسار الإغلاق' : 'Civil and infrastructure works near close-out'}</span>
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
            <div className="info-row" style={{ marginTop: 10 }}>
              <span>{t('timeline')}</span>
              <span>{lang === 'ar' ? 'من نوفمبر 2023 إلى يونيو 2026' : 'Nov 2023 to Jun 2026'}</span>
            </div>
            <div className="info-row">
              <span>{t('project_notes')}</span>
              <span>{lang === 'ar' ? 'حفر وبنية تحتية وفلل دوبلكس' : 'Excavation, infrastructure and duplex units'}</span>
            </div>
          </div>
        </Link>
      </div>

      <h2 className="section-title">{t('financial_summary')}</h2>
      <div className="grid grid-2">
        <div className="card" style={{ height: 320 }}>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            {lang === 'ar' ? 'إيرادات المشاريع مقابل المستحقات' : 'Project invoicing versus receivables'}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
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

        <div className="card" style={{ height: 320 }}>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            {lang === 'ar' ? 'مزيج التكاليف' : 'Cost composition'}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={costMixData}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={3}
              >
                {costMixData.map((entry, index) => (
                  <Cell key={entry.name} fill={costMixColors[index % costMixColors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8 }}
                formatter={(v) => v.toLocaleString('en-US')}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
