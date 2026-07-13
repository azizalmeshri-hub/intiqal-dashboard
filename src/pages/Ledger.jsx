import { useState, useMemo } from 'react'
import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import { projects } from '../data/projects'

export default function Ledger() {
  const { t, lang } = useLang()
  const [filter, setFilter] = useState('all')
  const [sortDesc, setSortDesc] = useState(true)

  const rows = useMemo(() => [
    ...projects.ajdan.suppliersContractors.map((s) => ({ ...s, project: lang === 'ar' ? 'أجدان' : 'Ajdan', amount: s.outstandingToUs ?? s.weOwe })),
    {
      name_ar: projects.sadra.contractorPayable.name_ar,
      name_en: projects.sadra.contractorPayable.name_en,
      amount: projects.sadra.contractorPayable.outstanding,
      type: 'we_owe',
      project: lang === 'ar' ? 'سدرة' : 'Sadra',
      lastActivity: projects.sadra.contractorPayable.lastInvoiceDate,
    },
  ], [lang])

  const filtered = rows
    .filter((r) => filter === 'all' || r.type === filter)
    .sort((a, b) => (sortDesc ? b.amount - a.amount : a.amount - b.amount))

  const totalOwedToUs = rows.filter((r) => r.type === 'we_are_owed').reduce((a, r) => a + r.amount, 0)
  const totalWeOwe = rows.filter((r) => r.type === 'we_owe').reduce((a, r) => a + r.amount, 0)

  return (
    <div>
      <h1 className="display">{t('nav_ledger')}</h1>
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <StatCard label={t('suppliers_owed_to_us')} value={totalOwedToUs} />
        <StatCard label={t('suppliers_we_owe')} value={totalWeOwe} />
        <StatCard label={t('net_position')} value={totalOwedToUs - totalWeOwe} />
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '20px 0 12px', flexWrap: 'wrap' }}>
        {['all', 'we_are_owed', 'we_owe'].map((f) => (
          <button
            key={f}
            className={`btn ${filter === f ? '' : 'secondary'}`}
            onClick={() => setFilter(f)}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {f === 'all' ? (lang === 'ar' ? 'الكل' : 'All') : f === 'we_are_owed' ? t('receivable') : t('payable')}
          </button>
        ))}
        <button className="btn secondary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => setSortDesc((s) => !s)}>
          {lang === 'ar' ? 'ترتيب حسب المبلغ' : 'Sort by amount'} {sortDesc ? '↓' : '↑'}
        </button>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'الجهة' : 'Party'}</th>
              <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
              <th>{t('entry_type')}</th>
              <th>{lang === 'ar' ? 'آخر نشاط' : 'Last Activity'}</th>
              <th>{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td>{lang === 'ar' ? r.name_ar : r.name_en}</td>
                <td>{r.project}</td>
                <td>{r.type === 'we_are_owed' ? t('receivable') : t('payable')}</td>
                <td className="mono">{r.lastActivity}</td>
                <td className={`num ${r.type === 'we_are_owed' ? 'pos' : 'neg'}`}>{r.amount.toLocaleString('en-US')} SAR</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
