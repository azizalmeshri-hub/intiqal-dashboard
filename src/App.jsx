import { HashRouter, Routes, Route } from 'react-router-dom'
import { LangProvider, useLang } from './context/LangContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import Sadra from './pages/Sadra'
import Ajdan from './pages/Ajdan'
import Ledger from './pages/Ledger'
import Upload from './pages/Upload'
import Employees from './pages/Employees'
import Login from './pages/Login'
import AdminData from './pages/AdminData'
import FinancialHealth from './pages/FinancialHealth'
import ProjectDeepDive from './pages/ProjectDeepDive'
import EmployeeDetail from './pages/EmployeeDetail'
import VAT from './pages/VAT'
import AppErrorBoundary from './components/AppErrorBoundary'

function Shell() {
  const { t, toggle, lang } = useLang()
  const { loading, isAuthenticated, signOut, role } = useAuth()

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h2 className="display">{lang === 'ar' ? 'جارٍ التحقق من الجلسة...' : 'Restoring session...'}</h2>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out failed', error)
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <div className="card-sub">{lang === 'ar' ? `الصلاحية: ${role}` : `Role: ${role}`}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="lang-toggle" onClick={toggle}>
              {lang === 'ar' ? 'EN' : 'AR'}
            </button>
            <button className="lang-toggle" onClick={handleSignOut}>
              {lang === 'ar' ? 'خروج' : 'Sign out'}
            </button>
          </div>
        </div>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/sadra" element={<Sadra />} />
          <Route path="/ajdan" element={<Ajdan />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/employees/:id" element={<EmployeeDetail />} />
          <Route path="/financial-health" element={<FinancialHealth />} />
          <Route path="/vat" element={<VAT />} />
          <Route path="/project/:id" element={<ProjectDeepDive />} />
          <Route path="/admin" element={<AdminData />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <LangProvider>
        <AuthProvider>
          <HashRouter>
            <Shell />
          </HashRouter>
        </AuthProvider>
      </LangProvider>
    </AppErrorBoundary>
  )
}
