import { useMemo, useState } from 'react'
import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import { projects } from '../data/projects'

export default function Ledger() {
  const { t, lang } = useLang()
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => [
    ...projects.ajdan.suppliersContractors.map((s) => ({ ...s, project: lang === 'ar' ? 'أجدان' : 'Ajdan' })),
    {
      name_ar: projects.sadra.contractorPayable.name_ar,
      name_en: 'Specialized Building Contracting Co.',
      weOwe: projects.sadra.contractorPayable.outstanding,
      type: 'we_owe',
      project: lang === 'ar' ? 'سدرة' : 'Sadra',
    },
  ], [lang])

  const totalOwedToUs = rows.filter((r) => r.type === 'we_are_owed').reduce((a, r) => a + r.outstandingToUs, 0)
  const totalWeOwe = rows.filter((r) => r.type === 'we_owe').reduce((a, r) => a + r.weOwe, 0)
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => filter === 'receivable' ? r.type === 'we_are_owed' : r.type === 'we_owe')

  return (
    <div>
      <h1 className="display">{t('nav_ledger')}</h1>
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <StatCard label={t('suppliers_owed_to_us')} value={totalOwedToUs} />
        <StatCard label={t('suppliers_we_owe')} value={totalWeOwe} />
        <StatCard label={t('net_position')} value={totalOwedToUs - totalWeOwe} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="filter-row">
          <button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('show_all')}</button>
          <button className={`filter-pill ${filter === 'receivable' ? 'active' : ''}`} onClick={() => setFilter('receivable')}>{t('show_receivables')}</button>
          <button className={`filter-pill ${filter === 'payable' ? 'active' : ''}`} onClick={() => setFilter('payable')}>{t('show_payables')}</button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'الجهة' : 'Party'}</th>
              <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
              <th>{t('entry_type')}</th>
              <th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={i}>
                <td>{lang === 'ar' ? r.name_ar : r.name_en}</td>
                <td>{r.project}</td>
                <td>{r.type === 'we_are_owed' ? t('receivable') : t('payable')}</td>
                <td className={`num ${r.type === 'we_are_owed' ? 'pos' : 'neg'}`}>
                  {(r.outstandingToUs ?? r.weOwe).toLocaleString('en-US')} SAR
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
