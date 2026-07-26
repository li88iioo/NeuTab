import { useState, useEffect, type ReactNode } from 'react'
import LoginPage from './LoginPage'
import { type Language } from '@neutab/shared/utils/i18n'
import { AUTH_LOGOUT_EVENT, UnauthorizedError, initStorageFromServer } from '~/shims/storage'

interface AuthGateProps {
  children: ReactNode
  language?: Language
}

export default function AuthGate({ children, language = 'zh' }: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // token 在 httpOnly cookie 中,前端读不到;向服务端探测会话有效性。
    // 迁移:清理旧版本落在 localStorage 的 token。
    try {
      localStorage.removeItem('neutab_token')
    } catch {
      // ignore
    }
    let cancelled = false
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data) => {
        if (!cancelled) setIsAuthenticated(Boolean(data?.authenticated))
      })
      .catch(() => {
        if (!cancelled) setIsAuthenticated(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 登录成功后从服务器加载数据
  useEffect(() => {
    if (isAuthenticated) {
      initStorageFromServer()
        .then(() => setIsLoading(false))
        .catch((e) => {
          // Token exists locally but server rejected it (secret rotated, expired, etc.)
          if (e instanceof UnauthorizedError) {
            setIsAuthenticated(false)
          }
          setIsLoading(false)
        })
    }
  }, [isAuthenticated])

  useEffect(() => {
    const onLogout = () => {
      setIsAuthenticated(false)
      setIsLoading(false)
    }
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout as any)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout as any)
  }, [])

  const handleLoginSuccess = (_token: string) => {
    setIsAuthenticated(true)
    setIsLoading(true)
  }

  if (isAuthenticated === null) {
    return null
  }

  if (!isAuthenticated) {
    return <LoginPage onSuccess={handleLoginSuccess} language={language} />
  }

  // 等待数据加载完成
  if (isLoading) {
    return null
  }

  return <>{children}</>
}
