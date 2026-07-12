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

      <h2 className="section-title">{t('total_contracts')}</h2>
      <div className="grid grid-3">
        <StatCard label={t('contract_value')} value={p.contractValuePlaceholder} sub={t('placeholder_notice')} />
        <StatCard label={t('outstanding') + ' — BPO32502845'} value={p.clientLedgers[0].outstanding} />
        <StatCard label={t('outstanding') + ' — BPO32504016'} value={p.clientLedgers[1].outstanding} />
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'مستحق للمقاول المنفذ' : 'Payable to Executing Contractor'}</h2>
      <div className="grid grid-3">
        <StatCard label={t('invoiced')} value={p.contractorPayable.totalInvoiced} />
        <StatCard label={t('received') /* paid by us */} value={p.contractorPayable.totalPaid} />
        <StatCard label={t('outstanding')} value={p.contractorPayable.outstanding} />
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
