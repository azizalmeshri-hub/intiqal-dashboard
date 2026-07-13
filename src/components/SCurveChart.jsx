import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { buildSCurve } from '../utils/schedule'
import { useLang } from '../context/LangContext'

export default function SCurveChart({ startDate, endDate, monthlyBilled, contractValue, today }) {
  const { lang } = useLang()
  const data = buildSCurve({ startDate, endDate, monthlyBilled, contractValue, today })
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 10, top: 10 }}>
          <defs>
            <linearGradient id="plannedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8fa3b3" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#8fa3b3" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8a33d" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#e8a33d" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a4258" />
          <XAxis dataKey="month" stroke="#8fa3b3" fontSize={10} />
          <YAxis stroke="#8fa3b3" fontSize={11} unit="%" />
          <Tooltip
            contentStyle={{ background: '#16293c', border: '1px solid #2a4258', borderRadius: 8, fontSize: 12 }}
            formatter={(v, name) => [`${v}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={todayKey} stroke="#d6584a" strokeDasharray="4 4" label={{ value: lang === 'ar' ? 'اليوم' : 'Today', fill: '#d6584a', fontSize: 11 }} />
          <Area type="monotone" dataKey="plannedPct" name={lang === 'ar' ? 'المخطط' : 'Planned'} stroke="#8fa3b3" fill="url(#plannedFill)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="actualPct" name={lang === 'ar' ? 'الفعلي (مفوتر)' : 'Actual (billed)'} stroke="#e8a33d" fill="url(#actualFill)" strokeWidth={2.5} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
