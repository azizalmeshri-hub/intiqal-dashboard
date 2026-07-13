import { useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { lang } = useLang()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn({ email, password })
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'فشل تسجيل الدخول' : 'Login failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="brand-mark">IC</div>
          <div>
            <div className="brand-name">{lang === 'ar' ? 'شركة انتقال للمقاولات العامة' : 'Intiqal General Contracting'}</div>
            <div className="brand-tag">{lang === 'ar' ? 'تسجيل الدخول إلى مركز القيادة' : 'Sign in to the command center'}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="side-stack">
          <div>
            <div className="card-label">{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'كلمة المرور' : 'Password'}</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>}

          <button className="btn" type="submit" disabled={submitting}>
            {submitting
              ? (lang === 'ar' ? 'جارٍ الدخول...' : 'Signing in...')
              : (lang === 'ar' ? 'دخول' : 'Sign in')}
          </button>
        </form>

        <p className="card-sub" style={{ marginTop: 12 }}>
          {lang === 'ar' ? 'لا يوجد تسجيل عام. إنشاء الحسابات يتم بواسطة المسؤول فقط.' : 'No public sign-up. Accounts are created by admins only.'}
        </p>
      </div>
    </div>
  )
}
