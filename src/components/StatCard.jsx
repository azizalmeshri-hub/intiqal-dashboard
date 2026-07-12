export default function StatCard({ label, value, sub, currency = 'SAR' }) {
  const formatted = typeof value === 'number'
    ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : value
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{formatted}{typeof value === 'number' ? ` ${currency}` : ''}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}
