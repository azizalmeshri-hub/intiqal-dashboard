import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, Moon, Sun } from 'lucide-react'
import { useLang } from '../../context/LangContext'
import { useAuth } from '../../context/AuthContext'
import { Button } from './Button'

const NAV_ITEMS = [
  { to: '/', keyEn: 'Overview', keyAr: 'نظرة عامة' },
  { to: '/sadra', keyEn: 'Sadra', keyAr: 'سدرة' },
  { to: '/ajdan', keyEn: 'Ajdan', keyAr: 'أجدان' },
  { to: '/ledger', keyEn: 'Ledger', keyAr: 'الذمم' },
  { to: '/smart-upload', keyEn: 'Smart Upload', keyAr: 'الرفع الذكي' },
  { to: '/employees', keyEn: 'Employees', keyAr: 'الموظفون' },
  { to: '/payroll', keyEn: 'Payroll', keyAr: 'الرواتب' },
  { to: '/vat', keyEn: 'VAT', keyAr: 'الضريبة' },
  { to: '/admin', keyEn: 'Admin', keyAr: 'الإدارة' },
]

function navLabel(item, lang) {
  return lang === 'ar' ? item.keyAr : item.keyEn
}

function displayName(user, lang) {
  const metadata = user?.user_metadata || {}
  const byLang = lang === 'ar' ? (metadata.name_ar || metadata.full_name) : (metadata.name_en || metadata.full_name)
  return byLang || user?.email || (lang === 'ar' ? 'مستخدم' : 'User')
}

function initials(name) {
  const clean = String(name || '').trim()
  if (!clean) return 'U'
  const parts = clean.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]).join('').toUpperCase()
}

export default function TopNav() {
  const { lang, toggle, isRtl } = useLang()
  const { user, role, signOut } = useAuth()
  const [width, setWidth] = useState(typeof window === 'undefined' ? 1400 : window.innerWidth)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem('intiqal-theme') || 'light'
  })

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('intiqal-theme', theme)
  }, [theme])

  const isMobile = width < 1024
  const visibleCount = width >= 1500 ? 8 : width >= 1360 ? 7 : width >= 1220 ? 6 : width >= 1080 ? 5 : 4

  const { visibleLinks, overflowLinks } = useMemo(() => ({
    visibleLinks: NAV_ITEMS.slice(0, visibleCount),
    overflowLinks: NAV_ITEMS.slice(visibleCount),
  }), [visibleCount])

  const name = displayName(user, lang)

  return (
    <header className="ds-card ds-fade-in mb-5 px-4 py-3 sm:px-5">
      <div className={`flex items-center justify-between gap-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div className={`flex min-w-0 items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <Link to="/" className="flex items-center gap-2 no-underline">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ds-accent-soft)] text-sm font-extrabold text-[var(--ds-accent)]">IQ</span>
            <span className="hidden text-sm font-bold text-[var(--ds-text)] sm:block">Intiqal Dashboard</span>
          </Link>

          {!isMobile ? (
            <nav className={`relative hidden items-center gap-1 lg:flex ${isRtl ? 'flex-row-reverse' : ''}`}>
              {visibleLinks.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-semibold no-underline ${isActive ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'text-[var(--ds-muted)] hover:bg-slate-100'}`}
                >
                  {navLabel(item, lang)}
                </NavLink>
              ))}

              {overflowLinks.length ? (
                <div className="relative">
                  <Button size="sm" className="h-9" onClick={() => setMoreOpen((v) => !v)}>
                    {lang === 'ar' ? 'المزيد' : 'More'}
                  </Button>
                  {moreOpen ? (
                    <div className="absolute top-11 z-20 min-w-[180px] rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 shadow-lg">
                      {overflowLinks.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setMoreOpen(false)}
                          className="block rounded-lg px-3 py-2 text-sm text-[var(--ds-text)] no-underline hover:bg-[var(--ds-surface-soft)]"
                        >
                          {navLabel(item, lang)}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </nav>
          ) : null}
        </div>

        <div className={`flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <Button variant="ghost" size="sm" onClick={toggle}>{lang === 'ar' ? 'EN' : 'ع'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </Button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setAvatarOpen((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2 py-1 ${isRtl ? 'flex-row-reverse' : ''}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ds-accent-soft)] text-xs font-bold text-[var(--ds-accent)]">{initials(name)}</span>
              <span className="hidden text-start sm:block">
                <span className="block max-w-[140px] truncate text-xs font-semibold text-[var(--ds-text)]">{name}</span>
                <span className="block text-[10px] uppercase tracking-[0.08em] text-[var(--ds-muted)]">{role}</span>
              </span>
            </button>

            {avatarOpen ? (
              <div className="absolute end-0 top-11 z-20 min-w-[180px] rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 shadow-lg">
                <div className="px-2 pb-2 text-xs text-[var(--ds-muted)]">{lang === 'ar' ? `الدور: ${role}` : `Role: ${role}`}</div>
                <Button className="w-full" variant="secondary" onClick={signOut}>{lang === 'ar' ? 'تسجيل خروج' : 'Sign out'}</Button>
              </div>
            ) : null}
          </div>

          {isMobile ? (
            <Button variant="secondary" size="sm" onClick={() => setMobileOpen((v) => !v)}>
              <Menu size={15} />
            </Button>
          ) : null}
        </div>
      </div>

      {isMobile && mobileOpen ? (
        <nav className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--ds-border)] pt-3 sm:grid-cols-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-semibold text-center no-underline ${isActive ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'bg-[var(--ds-surface-soft)] text-[var(--ds-muted)]'}`}
            >
              {navLabel(item, lang)}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </header>
  )
}
