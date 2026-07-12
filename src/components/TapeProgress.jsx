export default function TapeProgress({ percent }) {
  const pct = Math.max(0, Math.min(100, percent))
  return (
    <div className="tape">
      <div className="tape-fill" style={{ width: `${pct}%` }} />
      <div className="tape-label">{pct.toFixed(1)}%</div>
    </div>
  )
}
