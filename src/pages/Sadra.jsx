import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import { projects } from '../data/projects'

export default function Sadra() {
  const { t, lang } = useLang()
  const p = projects.sadra

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 className="display">{lang === 'ar' ? p.name_ar : p.name_en}</h1>
        <StatusBadge status={p.status} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="info-row"><span>{t('owner')}</span><span>{lang === 'ar' ? p.owner_ar : p.owner_en}</span></div>
        <div className="info-row"><span>{t('role')}</span><span>{lang === 'ar' ? p.role_ar : p.role_en}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'المقاول المنفذ' : 'Executing Contractor'}</span><span>{lang === 'ar' ? p.contractor_ar : p.contractor_en}</span></div>
        <div className="info-row"><span>{t('location')}</span><span>{lang === 'ar' ? p.location_ar : p.location_en}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'أوامر الشراء' : 'Purchase Orders'}</span><span className="mono">{p.pos.join(' / ')}</span></div>
      </div>

      <h2 className="section-title">{t('completion')}</h2>
      <div className="card">
        <TapeProgress percent={p.percentComplete} />
        <p className="tag-note" style={{ marginTop: 12 }}>
          {lang === 'ar'
            ? 'نسبة الإنجاز 95% استناداً إلى تأكيد المستخدم — راجع كشف الحساب لتفاصيل المستخلصات.'
            : '95% completion per confirmed status — see ledger below for milestone-level detail.'}
        </p>
      </div>

      <h2 className="section-title">{t('project_summary')}</h2>
      <div className="grid grid-4">
        <StatCard label={t('contract_value')} value={p.contractValuePlaceholder} sub={t('placeholder_notice')} />
        <StatCard label={t('direct_costs')} value={p.finance.directCost} />
        <StatCard label={t('indirect_costs')} value={p.finance.indirectCost} />
        <StatCard label={t('overhead_cost')} value={p.finance.overheadCost} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card side-stack">
          <div className="info-row"><span>{t('timeline')}</span><span>{p.timeline.start} → {p.timeline.end}</span></div>
          <div className="info-row"><span>{t('milestones')}</span><span>{p.timeline.milestone}</span></div>
          <div className="info-row"><span>{lang === 'ar' ? 'المسار المالي' : 'Financial path'}</span><span className="pos">{p.finance.projectedMargin.toLocaleString('en-US')} SAR</span></div>
        </div>
        <div className="card side-stack">
          <div className="info-row"><span>{lang === 'ar' ? 'مستحق للمقاول المنفذ' : 'Payable to Executing Contractor'}</span><span className="mono">{p.contractorPayable.outstanding.toLocaleString('en-US')} SAR</span></div>
          <div className="info-row"><span>{t('invoiced')}</span><span className="mono">{p.contractorPayable.totalInvoiced.toLocaleString('en-US')} SAR</span></div>
          <div className="info-row"><span>{t('received')}</span><span className="mono">{p.contractorPayable.totalPaid.toLocaleString('en-US')} SAR</span></div>
        </div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'كشوف حساب العميل (روشن)' : 'Client Ledgers (Roshn)'}</h2>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'أمر الشراء' : 'PO'}</th>
              <th>{t('outstanding')}</th>
            </tr>
          </thead>
          <tbody>
            {p.clientLedgers.map((l) => (
              <tr key={l.po}>
                <td className="mono">{l.po}</td>
                <td className="num pos">{l.outstanding.toLocaleString('en-US')} SAR</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
