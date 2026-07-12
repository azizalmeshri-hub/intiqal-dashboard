import { createContext, useContext, useState, useEffect } from 'react'
import { dict } from '../i18n/dictionary'

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState('ar')

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const t = (key) => dict[lang][key] ?? key
  const toggle = () => setLang((l) => (l === 'ar' ? 'en' : 'ar'))

  return (
    <LangContext.Provider value={{ lang, t, toggle, isRtl: lang === 'ar' }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
