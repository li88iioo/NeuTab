import { useState, useEffect, type ReactNode } from 'react'
import LoginPage from './LoginPage'
import { type Language } from '@neutab/shared/utils/i18n'
import { AUTH_LOGOUT_EVENT, UnauthorizedError, initStorageFromServer } from '~/shims/storage'

interface AuthGateProps {
  children: ReactNode
  language?: Language
}

function isTokenValid(token: string | null): boolean {
  if (!token) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    const base64UrlDecode = (input: string): string => {
      const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
      const padLen = (4 - (base64.length % 4)) % 4
      const padded = base64 + '='.repeat(padLen)
      return atob(padded)
    }

    const payload = JSON.parse(base64UrlDecode(parts[1]))
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export default function AuthGate({ children, language = 'zh' }: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('neutab_token')
    setIsAuthenticated(isTokenValid(token))
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
