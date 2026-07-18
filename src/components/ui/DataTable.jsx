import { cn } from '../../lib/utils'

export default function DataTable({ columns, rows, className }) {
  return (
    <div className={cn('ds-card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ds-border)] bg-[var(--ds-surface-soft)]">
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-start text-xs font-bold uppercase tracking-[0.08em] text-[var(--ds-muted)]">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id || idx} className="border-b border-[var(--ds-border)] last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-[var(--ds-text)]">
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
