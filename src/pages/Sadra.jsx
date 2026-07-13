import { useLang } from '../context/LangContext'
import StatCard from '../components/StatCard'
import TapeProgress from '../components/TapeProgress'
import StatusBadge from '../components/StatusBadge'
import SCurveChart from '../components/SCurveChart'
import ExpandableRow from '../components/ExpandableRow'
import { projects, TODAY } from '../data/projects'
import { computeRisk } from '../utils/risk'

export default function Sadra() {
  const { t, lang } = useLang()
  const p = projects.sadra
  const totalOutstanding = p.clientLedgers.reduce((a, l) => a + l.outstanding, 0)

  const risk = computeRisk({
    startDate: p.startDate,
    endDate: p.endDate,
    today: TODAY,
    actualCompletionPct: p.percentComplete,
    outstanding: totalOutstanding,
    contractValue: p.contractValuePlaceholder,
    lastActivityDate: p.clientLedgers[0].lastInvoiceDate,
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 className="display">{lang === 'ar' ? p.name_ar : p.name_en}</h1>
        <StatusBadge status={risk.status} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="info-row"><span>{t('owner')}</span><span>{lang === 'ar' ? p.owner_ar : p.owner_en}</span></div>
        <div className="info-row"><span>{t('role')}</span><span>{lang === 'ar' ? p.role_ar : p.role_en}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'المقاول المنفذ' : 'Executing Contractor'}</span><span>{lang === 'ar' ? p.contractor_ar : p.contractor_en}</span></div>
        <div className="info-row"><span>{t('location')}</span><span>{lang === 'ar' ? p.location_ar : p.location_en}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'المدة' : 'Timeline'}</span><span className="mono">{p.startDate} → {p.endDate}</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'أوامر الشراء' : 'Purchase Orders'}</span><span className="mono">{p.pos.join(' / ')}</span></div>
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'منحنى الإنجاز (S-Curve): المخطط مقابل الفعلي' : 'S-Curve: Planned vs. Actual Progress'}</h2>
      <div className="card">
        <SCurveChart startDate={p.startDate} endDate={p.endDate} monthlyBilled={p.monthlyBilled} contractValue={p.contractValuePlaceholder} today={TODAY} />
        <p className="tag-note" style={{ marginTop: 8 }}>
          {lang === 'ar'
            ? `التقدم الفعلي: ${p.percentComplete}% (مؤكد) — التقدم المتوقع حسب الجدول: ${risk.expectedPct}%. المنحنى يستخدم قيمة العقد المبدئية لأغراض العرض.`
            : `Actual progress: ${p.percentComplete}% (confirmed) — schedule-expected: ${risk.expectedPct}%. Curve uses the placeholder contract value for scaling.`}
        </p>
      </div>

      <h2 className="section-title">{t('completion')}</h2>
      <div className="card"><TapeProgress percent={p.percentComplete} /></div>

      <h2 className="section-title">{t('total_contracts')}</h2>
      <div className="grid grid-3">
        <StatCard label={t('contract_value')} value={p.contractValuePlaceholder} sub={t('placeholder_notice')} />
        <StatCard label={t('outstanding') + ' (Client)'} value={totalOutstanding} />
        <StatCard label={lang === 'ar' ? 'مستحق للمقاول المنفذ' : 'Payable to Contractor'} value={p.contractorPayable.outstanding} />
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'كشوف حساب العميل (روشن) — انقر للتفاصيل' : 'Client Ledgers (Roshn) — click to expand'}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {p.clientLedgers.map((l) => (
          <ExpandableRow
            key={l.po}
            summary={
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span className="mono">{l.po}</span>
                <span className="num pos" style={{ fontFamily: 'var(--font-mono)' }}>{l.outstanding.toLocaleString('en-US')} SAR</span>
              </div>
            }
          >
            <div className="info-row"><span>{lang === 'ar' ? 'آخر فاتورة' : 'Last Invoice'}</span><span className="mono">{l.lastInvoiceDate}</span></div>
            <div className="info-row"><span>{t('outstanding')}</span><span className="mono">{l.outstanding.toLocaleString('en-US')} SAR</span></div>
          </ExpandableRow>
        ))}
      </div>

      <h2 className="section-title">{lang === 'ar' ? 'مستحق للمقاول المنفذ' : 'Payable to Executing Contractor'}</h2>
      <ExpandableRow
        summary={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <span>{lang === 'ar' ? p.contractorPayable.name_ar : p.contractorPayable.name_en}</span>
            <span className="mono neg">{p.contractorPayable.outstanding.toLocaleString('en-US')} SAR</span>
          </div>
        }
        defaultOpen
      >
        <div className="info-row"><span>{t('invoiced')}</span><span className="mono">{p.contractorPayable.totalInvoiced.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'مدفوع' : 'Paid'}</span><span className="mono pos">{p.contractorPayable.totalPaid.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{t('outstanding')}</span><span className="mono">{p.contractorPayable.outstanding.toLocaleString('en-US')} SAR</span></div>
        <div className="info-row"><span>{lang === 'ar' ? 'آخر فاتورة' : 'Last Invoice'}</span><span className="mono">{p.contractorPayable.lastInvoiceDate}</span></div>
      </ExpandableRow>
    </div>
  )
}
