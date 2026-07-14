import { NavLink } from 'react-router-dom'
import { useLang } from '../context/LangContext'

const items = [
  { to: '/', key: 'nav_overview' },
  { to: '/sadra', key: 'nav_sadra' },
  { to: '/ajdan', key: 'nav_ajdan' },
  { to: '/ledger', key: 'nav_ledger' },
  { to: '/upload', key: 'nav_upload' },
  { to: '/smart-upload', key: 'nav_smart_upload' },
  { to: '/employees', key: 'nav_employees' },
  { to: '/financial-health', key: 'nav_financial_health' },
  { to: '/vat', key: 'nav_vat' },
  { to: '/admin', key: 'nav_admin' },
]

export default function Sidebar() {
  const { t } = useLang()
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">IC</div>
        <div>
          <div className="brand-name">{t('appName')}</div>
          <div className="brand-tag">{t('tagline')}</div>
        </div>
      </div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span className="nav-tick" />
          {t(item.key)}
        </NavLink>
      ))}
    </aside>
  )
}
