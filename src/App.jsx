import { HashRouter, Routes, Route } from 'react-router-dom'
import { LangProvider, useLang } from './context/LangContext'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import Sadra from './pages/Sadra'
import Ajdan from './pages/Ajdan'
import Ledger from './pages/Ledger'
import Upload from './pages/Upload'

function Shell() {
  const { t, toggle, lang } = useLang()
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <div />
          <button className="lang-toggle" onClick={toggle}>
            {lang === 'ar' ? 'EN' : 'AR'}
          </button>
        </div>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/sadra" element={<Sadra />} />
          <Route path="/ajdan" element={<Ajdan />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/upload" element={<Upload />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <LangProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </LangProvider>
  )
}
