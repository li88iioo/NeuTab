import { useState, useEffect, useRef, type FormEvent } from 'react'
import { getTranslations, type Language } from '@neutab/shared/utils/i18n'
import { applyThemeClasses } from '@neutab/shared/utils/theme'
import type { ThemeMode, VisualTheme } from '@neutab/shared/utils/settings'
import '@neutab/ui/styles/style.css'
import '@neutab/ui/styles/themes/liquid-glass.css'
import './LoginPage.css'

interface LoginPageProps {
  onSuccess: (token: string) => void
  language?: Language
}

export default function LoginPage({ onSuccess, language = 'zh' }: LoginPageProps) {
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>(0)
  const prevRetryAfterSecondsRef = useRef(0)
  const t = getTranslations(language)

  useEffect(() => {
    const cachedMode = localStorage.getItem('theme_mode_cache') as ThemeMode | null
    const cachedVisual = localStorage.getItem('visual_theme_cache') as VisualTheme | null
    applyThemeClasses(cachedMode || 'auto', cachedVisual || 'neumorphic', {
      cleanupEarlyFallback: false,
    })
    requestAnimationFrame(() => {
      document.body.classList.remove('no-transition')
      setMounted(true)
    })
  }, [])

  useEffect(() => {
    if (retryAfterSeconds <= 0) return
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [retryAfterSeconds])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!authCode.trim()) return
    if (retryAfterSeconds > 0) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode: authCode.trim() })
      })

      const data = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        const code = String((data as any)?.code || '')
        if (res.status === 401 || code === 'INVALID_AUTH_CODE') {
          setError(t.loginError)
        } else if (res.status === 429 || code === 'TOO_MANY_REQUESTS') {
          const retryAfterHeader = res.headers.get('Retry-After')
          const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0
          if (seconds > 0) {
            setRetryAfterSeconds(seconds)
            setError(t.loginTooManyAttemptsRetry.replace('{seconds}', String(seconds)))
          } else {
            setError(t.loginTooManyAttempts)
          }
        } else if (res.status === 500 || code === 'AUTH_CODE_NOT_CONFIGURED') {
          setError(t.loginServerNotConfigured)
        } else {
          setError(t.loginError)
        }
        return
      }

      if (data.token) {
        localStorage.setItem('neutab_token', data.token)
        setRetryAfterSeconds(0)
        onSuccess(data.token)
      }
    } catch {
      setError(t.loginError)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const prev = prevRetryAfterSecondsRef.current
    prevRetryAfterSecondsRef.current = retryAfterSeconds

    if (!error && retryAfterSeconds <= 0) return

    if (retryAfterSeconds > 0) {
      setError(t.loginTooManyAttemptsRetry.replace('{seconds}', String(retryAfterSeconds)))
      return
    }

    // Countdown finished: keep a friendly message, but avoid showing "0 seconds".
    if (prev > 0 && retryAfterSeconds === 0) {
      setError(t.loginTooManyAttempts)
    }
  }, [retryAfterSeconds, t, error])

  return (
    <div className={`login-page ${mounted ? 'mounted' : ''}`}>
      <div className="login-card">
        <h1 className="login-title">NeuTab</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-input-row">
            <div className="login-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                placeholder={t.loginPlaceholder}
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                autoFocus
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-toggle-visibility"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <button
              type="submit"
              className="login-submit"
              disabled={loading || retryAfterSeconds > 0 || !authCode.trim()}
              aria-label={retryAfterSeconds > 0 ? t.loginTooManyAttemptsRetry.replace('{seconds}', String(retryAfterSeconds)) : t.loginButton}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
          <p
            className={`login-error${error ? " visible" : ""}`}
            role="status"
            aria-live="polite"
            aria-hidden={!error}>
            {error}
          </p>
        </form>
      </div>
    </div>
  )
}
