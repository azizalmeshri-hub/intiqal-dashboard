export default function EditableTable({
  title,
  lang,
  columns,
  rows,
  canEdit,
  onChangeCell,
  onDeleteRow,
  onOpenAdd,
  statusByCell,
  rowWarnings,
  rowErrors,
  emptyLabel,
}) {
  const statusText = (status) => {
    if (status === 'saving') return lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'
    if (status === 'saved') return lang === 'ar' ? 'تم ✓' : 'Saved ✓'
    if (status === 'retry') return lang === 'ar' ? 'إعادة المحاولة' : 'Retry'
    return ''
  }

  const renderCell = (row, col) => {
    const key = `${row.id}:${col.key}`
    const status = statusByCell[key]

    if (!canEdit || col.editable === false) {
      if (col.type === 'select') {
        const match = (col.options || []).find((opt) => String(opt.value) === String(row[col.key] ?? ''))
        return <span>{match?.label || '-'}</span>
      }
      return <span>{row[col.key] == null || row[col.key] === '' ? '-' : String(row[col.key])}</span>
    }

    if (col.type === 'select') {
      return (
        <div className="cell-edit-wrap">
          <select
            value={row[col.key] ?? ''}
            onChange={(e) => onChangeCell(row.id, col.key, e.target.value)}
          >
            <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
            {(col.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {status ? <span className="save-pill">{statusText(status)}</span> : null}
        </div>
      )
    }

    return (
      <div className="cell-edit-wrap">
        <input
          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
          step={col.type === 'number' ? '0.01' : undefined}
          value={row[col.key] ?? ''}
          onChange={(e) => onChangeCell(row.id, col.key, e.target.value)}
        />
        {status ? <span className="save-pill">{statusText(status)}</span> : null}
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="section-title" style={{ margin: 0 }}>{title}</div>
        {canEdit ? (
          <button className="btn" type="button" onClick={onOpenAdd}>
            {lang === 'ar' ? 'إضافة جديد' : 'Add New'}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card-sub">{emptyLabel}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{lang === 'ar' ? (col.labelAr || col.label) : col.label}</th>
                ))}
                {canEdit ? <th>{lang === 'ar' ? 'حذف' : 'Delete'}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td key={`${row.id}-${col.key}`}>{renderCell(row, col)}</td>
                  ))}
                  {canEdit ? (
                    <td>
                      <button className="btn secondary" type="button" onClick={() => onDeleteRow(row)}>
                        {lang === 'ar' ? 'حذف' : 'Delete'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Object.values(rowWarnings || {}).length > 0 && (
        <div className="card-sub" style={{ marginTop: 10, color: 'var(--amber)' }}>
          {Object.values(rowWarnings)[0]}
        </div>
      )}
      {Object.values(rowErrors || {}).length > 0 && (
        <div className="card-sub" style={{ marginTop: 10, color: 'var(--red)' }}>
          {Object.values(rowErrors)[0]}
        </div>
      )}
    </div>
  )
}
