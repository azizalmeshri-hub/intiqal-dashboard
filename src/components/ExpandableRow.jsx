import { useState } from 'react'

export default function ExpandableRow({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset', cursor: 'pointer', width: '100%', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', boxSizing: 'border-box',
        }}
      >
        {summary}
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: 'var(--steel-400)', flexShrink: 0, marginInlineStart: 12 }}>
          ›
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--line)' }}>
          {children}
        </div>
      )}
    </div>
  )
}
