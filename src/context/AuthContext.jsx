import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return role === 'admin' ? 'admin' : 'viewer'
}

function roleFromUserMetadata(user) {
  const metaRole = user?.user_metadata?.role || user?.app_metadata?.role
  return normalizeRole(metaRole)
}

async function loadProfileRole(user) {
  const userId = user?.id
  if (!userId) return 'viewer'

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('Failed to load profile role:', error.message)
    return roleFromUserMetadata(user)
  }

  const normalized = normalizeRole(data?.role)
  if (normalized === 'viewer') {
    return roleFromUserMetadata(user)
  }

  return normalized
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(true)
  const [refreshingRole, setRefreshingRole] = useState(false)

  const refreshRole = useCallback(async () => {
    const currentUser = session?.user
    if (!currentUser?.id) {
      setRole('viewer')
      return 'viewer'
    }

    setRefreshingRole(true)
    try {
      const nextRole = await loadProfileRole(currentUser)
      setRole(nextRole)
      return nextRole
    } finally {
      setRefreshingRole(false)
    }
  }, [session])

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession()
      const currentSession = data?.session || null

      if (!mounted) return
      setSession(currentSession)

      if (currentSession?.user?.id) {
        const nextRole = await loadProfileRole(currentSession.user)
        if (mounted) setRole(nextRole)
      } else {
        setRole('viewer')
      }

      if (mounted) setLoading(false)
    }

    bootstrap()

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession)

      if (nextSession?.user?.id) {
        const nextRole = await loadProfileRole(nextSession.user)
        if (mounted) setRole(nextRole)
      } else {
        setRole('viewer')
      }

      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const signIn = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    role,
    loading,
    refreshingRole,
    isAuthenticated: Boolean(session),
    isAdmin: role === 'admin',
    refreshRole,
    signIn,
    signOut,
  }), [session, role, loading, refreshingRole, refreshRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
