import { useState } from 'react'
import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import SCurveChart from '../components/SCurveChart'
import AgingBar from '../components/AgingBar'
import ExpandableRow from '../components/ExpandableRow'
import { projects, TODAY } from '../data/projects'
import { computeRisk, agingBucket } from '../utils/risk'

export default function Ajdan() {
  const { t, lang } = useLang()
  const p = projects.ajdan
  const [filter, setFilter] = useState('all')

  const actualCompletionPct = (p.completedInclAdvance / p.contractValue) * 100
  const risk = computeRisk({
    startDate: p.startDate,
    endDate: p.endDate,
    today: TODAY,
    actualCompletionPct,
    outstanding: p.clientLedgerSummary.outstanding,
    contractValue: p.contractValue,
    lastActivityDate: p.clientLedgerSummary.lastInvoiceDate,
  })

  const filteredSuppliers = p.suppliersContractors.filter((s) => filter === 'all' || s.type === filter)
  const totalWeAreOwed = p.suppliersContractors.filter((s) => s.type === 'we_are_owed').reduce((a, s) => a + s.outstandingToUs, 0)
  const totalWeOwe = p.suppliersContractors.filter((s) => s.type === 'we_owe').reduce((a, s) => a + s.weOwe, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 className="display">{lang === 'ar' ? p.name_ar : p.name_en}</h1>
        <StatusBadge status={risk.status} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="info-row"><span>{t('owner')}</span><span>{lang === 'ar' ? p.owner_ar : p.owner_en}</span></div>
        <div className="info-row"><span>{t('role')}</span><span>{lang === 'ar' ? p.role_ar : p.role_en}</span></div>
        <div className="info-row"><span>{t('location')}</span><span>{lang === 'ar' ? p.location_ar : p.location_en}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'المدة' : 'Timeline'}</span><span className="mono">{p.startDate} → {p.endDate}</span></div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'منحنى الإنجاز (S-Curve): المخطط مقابل الفعلي' : 'S-Curve: Planned vs. Actual Progress'}</h2>
      <div className="card">
        <SCurveChart startDate={p.startDate} endDate={p.endDate} monthlyBilled={p.monthlyBilled} contractValue={p.contractValue} today={TODAY} />
        <p className="tag-note" style={{ marginTop: 8 }}>
          {lang === 'ar'
            ? `التقدم الفعلي (شامل الدفعة المقدمة): ${actualCompletionPct.toFixed(1)}% — المتوقع حسب الجدول: ${risk.expectedPct}%.`
            : `Actual progress (incl. advance): ${actualCompletionPct.toFixed(1)}% — schedule-expected: ${risk.expectedPct}%.`}
        </p>
      </div>

      <h2 className="section-title">{t('completion')}</h2>
      <div className="card"><TapeProgress percent={Math.min(actualCompletionPct, 100)} /></div>

      <h2 className="section-title">{t('contract_value')}</h2>
      <div className="grid grid-4">
        <StatCard label={t('contract_value')} value={p.contractValue} />
        <StatCard label={lang === 'ar' ? 'الدفعة المقدمة (2.5%)' : 'Advance Payment (2.5%)'} value={p.advancePayment} />
        <StatCard label={lang === 'ar' ? 'المنجز شامل الدفعة المقدمة' : 'Completed incl. Advance'} value={p.completedInclAdvance} />
        <StatCard label={lang === 'ar' ? 'المتبقي من المشروع' : 'Remaining on Contract'} value={p.remainingOnProject} />
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'كشف حساب العميل (الأولى منازل)' : 'Client Ledger (Al Oula Manazil)'}</h2>
      <ExpandableRow
        defaultOpen
        summary={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <span>{lang === 'ar' ? 'ملخص كشف الحساب' : 'Ledger Summary'}</span>
            <span className="mono">{p.clientLedgerSummary.outstanding.toLocaleString('en-US')} SAR {t('outstanding')}</span>
          </div>
        }
      >
        <div className="info-row"><span>{t('invoiced')}</span><span className="mono">{p.clientLedgerSummary.totalInvoiced.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{t('received')}</span><span className="mono pos">{p.clientLedgerSummary.totalReceived.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{t('outstanding')}</span><span className="mono">{p.clientLedgerSummary.outstanding.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'آخر فاتورة' : 'Last Invoice'}</span><span className="mono">{p.clientLedgerSummary.lastInvoiceDate}</span></div>
      </ExpandableRow>

      <h2 className="section-title">{lang === 'ar' ? 'الموردون والمقاولون' : 'Suppliers & Contractors'}</h2>
      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <StatCard label={t('suppliers_owed_to_us')} value={totalWeAreOwed} />
        <StatCard label={t('suppliers_we_owe')} value={totalWeOwe} />
        <StatCard label={t('net_position')} value={totalWeAreOwed - totalWeOwe} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredSuppliers.map((s, i) => {
          const amount = s.outstandingToUs ?? s.weOwe
          return (
            <ExpandableRow
              key={i}
              summary={
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span>{lang === 'ar' ? s.name_ar : s.name_en}</span>
                  <span className={`mono ${s.type === 'we_are_owed' ? 'pos' : 'neg'}`}>{amount.toLocaleString('en-US')} SAR</span>
                </div>
              }
            >
              <div className="info-row"><span>{t('entry_type')}</span><span>{s.type === 'we_are_owed' ? t('receivable') : t('payable')}</span></div>
              <div className="info-row"><span>{lang === 'ar' ? 'آخر نشاط' : 'Last Activity'}</span><span className="mono">{s.lastActivity}</span></div>
              {s.aging && (
                <div style={{ marginTop: 10 }}>
                  <div className="card-label">{lang === 'ar' ? 'أعمار الديون' : 'Aging'}</div>
                  <AgingBar aging={s.aging} />
                </div>
              )}
            </ExpandableRow>
          )
        })}
      </div>
    </div>
  )
}
