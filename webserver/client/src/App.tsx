import { useEffect, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiArrowUp, FiSettings } from "react-icons/fi"
import AuthGate from "./AuthGate"
import { ErrorBoundary, Header } from "@neutab/ui"
import SearchBar from "~/components/search/SearchBar"
import QuickLaunch from "~/components/quick-launch/QuickLaunch"
import SettingsPanel from "~/components/settings/SettingsPanel"
import { DEFAULT_SETTINGS, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import { getTranslations, type Language } from "@neutab/shared/utils/i18n"
import "@neutab/ui/styles/style.css"
import "@neutab/ui/styles/themes/liquid-glass.css"
import { applyLayoutVariables, applyThemeClasses } from "@neutab/shared/utils/theme"
import { sanitizeUrl } from "@neutab/shared/utils/validation"

const getInitialVisibility = (key: string, defaultValue: boolean): boolean => {
  try {
    const cached = localStorage.getItem(`viz_${key}`)
    return cached === null ? defaultValue : cached === "true"
  } catch {
    return defaultValue
  }
}

const getInitialLanguage = (defaultValue: Language): Language => {
  try {
    const cached = localStorage.getItem("lang_cache")
    return cached === "en" || cached === "zh" ? cached : defaultValue
  } catch {
    return defaultValue
  }
}

function NewTabContent() {
  const [themeMode, , { isLoading: themeModeLoading }] = useStorage<ThemeMode>("themeMode", DEFAULT_SETTINGS.themeMode)
  const [visualTheme, , { isLoading: visualThemeLoading }] = useStorage<VisualTheme>("visualTheme", DEFAULT_SETTINGS.visualTheme)

  const [showSearchBar, , { isLoading: showSearchBarLoading }] = useStorage("showSearchBar", getInitialVisibility("search", DEFAULT_SETTINGS.showSearchBar))
  const [showClock, , { isLoading: showClockLoading }] = useStorage("showClock", getInitialVisibility("clock", DEFAULT_SETTINGS.showClock))
  const [showSeconds] = useStorage("showSeconds", getInitialVisibility("seconds", DEFAULT_SETTINGS.showSeconds))
  const [language] = useStorage<Language>("language", getInitialLanguage(DEFAULT_SETTINGS.language))
  const resolvedLanguage = language || DEFAULT_SETTINGS.language
  const t = getTranslations(resolvedLanguage)

  const [contentMaxWidth, , { isLoading: loadingMaxWidth }] = useStorage("contentMaxWidth", DEFAULT_SETTINGS.contentMaxWidth)
  const [contentPaddingX, , { isLoading: loadingPaddingX }] = useStorage("contentPaddingX", DEFAULT_SETTINGS.contentPaddingX)
  const [contentPaddingTop, , { isLoading: loadingPaddingTop }] = useStorage("contentPaddingTop", DEFAULT_SETTINGS.contentPaddingTop)
  const [contentPaddingBottom, , { isLoading: loadingPaddingBottom }] = useStorage("contentPaddingBottom", DEFAULT_SETTINGS.contentPaddingBottom)
  const [iconBorderRadius, , { isLoading: loadingRadius }] = useStorage("iconBorderRadius", DEFAULT_SETTINGS.iconBorderRadius)
  const [cardSize, , { isLoading: loadingCardSize }] = useStorage("cardSize", DEFAULT_SETTINGS.cardSize)

  const [siteTitle] = useStorage("siteTitle", DEFAULT_SETTINGS.siteTitle)
  const [siteFavicon] = useStorage("siteFavicon", DEFAULT_SETTINGS.siteFavicon)

  const [showSettings, setShowSettings] = useState(false)
  const defaultTitleRef = useRef<string | null>(null)
  const defaultFaviconRef = useRef<string | null>(null)

  const [isContentReady, setIsContentReady] = useState(false)
  const layoutRafRef = useRef<number | null>(null)
  const isInitialLayoutRef = useRef(true)

  const isLayoutLoading = loadingMaxWidth || loadingPaddingX || loadingPaddingTop || loadingPaddingBottom || loadingRadius || loadingCardSize
  const isVisibilityLoading = showSearchBarLoading || showClockLoading

  useEffect(() => {
    if (isLayoutLoading) setIsContentReady(false)
  }, [isLayoutLoading])

  useEffect(() => {
    if (themeModeLoading || visualThemeLoading) return

    applyThemeClasses(themeMode, visualTheme)

    localStorage.setItem("theme_mode_cache", themeMode || "auto")
    localStorage.setItem("visual_theme_cache", visualTheme || "neumorphic")

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      if (themeMode === "auto") {
        applyThemeClasses("auto", visualTheme)
      }
    }
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [themeMode, visualTheme, themeModeLoading, visualThemeLoading])

  useEffect(() => {
    document.body.classList.remove("init-hide-header", "init-hide-search")
    document.body.classList.toggle("hide-search-bar", !showSearchBar)
    document.body.classList.toggle("hide-header", !showClock)
  }, [showSearchBar, showClock, isVisibilityLoading])

  useEffect(() => {
    if (isLayoutLoading) return

    if (layoutRafRef.current) cancelAnimationFrame(layoutRafRef.current)

    layoutRafRef.current = requestAnimationFrame(() => {
      applyLayoutVariables({
        contentMaxWidth,
        contentPaddingX,
        contentPaddingTop,
        contentPaddingBottom,
        iconBorderRadius,
        cardSize
      })

      setIsContentReady(true)

      if (isInitialLayoutRef.current) {
        isInitialLayoutRef.current = false
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.body.classList.remove("no-transition")
          })
        })
      }
      layoutRafRef.current = null
    })

    return () => {
      if (layoutRafRef.current) cancelAnimationFrame(layoutRafRef.current)
    }
  }, [contentMaxWidth, contentPaddingX, contentPaddingTop, contentPaddingBottom, iconBorderRadius, cardSize, isLayoutLoading])

  useEffect(() => {
    if (defaultTitleRef.current === null) {
      defaultTitleRef.current = document.title
    }
    const title = siteTitle?.trim() || defaultTitleRef.current || ""
    if (title) document.title = title
  }, [siteTitle])

  useEffect(() => {
    if (defaultFaviconRef.current === null) {
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      defaultFaviconRef.current = existing?.href ?? null
    }
    const faviconValue = siteFavicon?.trim() || ""
    const safeFaviconValue = (() => {
      if (!faviconValue) return ""
      if (faviconValue.startsWith("data:image/")) return faviconValue
      try {
        return sanitizeUrl(faviconValue)
      } catch {
        return ""
      }
    })()
    const customLink = document.querySelector<HTMLLinkElement>('link#custom-favicon')

    if (safeFaviconValue) {
      const link = customLink || document.createElement("link")
      link.id = "custom-favicon"
      link.rel = "icon"
      link.href = safeFaviconValue
      document.head.appendChild(link)
    } else if (customLink) {
      customLink.remove()
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      if (existing && defaultFaviconRef.current) {
        existing.href = defaultFaviconRef.current
      }
    }
  }, [siteFavicon])

  const [isIdle, setIsIdle] = useState(false)
  const [isScrolling, setIsScrolling] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const settingsFabRef = useRef<HTMLButtonElement | null>(null)
  const backToTopRef = useRef<HTMLButtonElement | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityRafRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isScrollingRef = useRef(false)
  const lastScrollContainerRef = useRef<EventTarget | null>(null)

  useEffect(() => {
    const blurFloatingButtonsIfFocused = () => {
      const active = document.activeElement
      if (active === settingsFabRef.current || active === backToTopRef.current) {
        ;(active as HTMLElement).blur()
      }
    }

    const scheduleActivity = () => {
      if (activityRafRef.current != null) return
      activityRafRef.current = window.requestAnimationFrame(() => {
        activityRafRef.current = null
        setIsIdle((prev) => (prev ? false : prev))

        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => {
          blurFloatingButtonsIfFocused()
          setIsIdle(true)
        }, 3000)
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      scheduleActivity()
      if (e.key.toLowerCase() === 's' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        setShowSettings((prev) => !prev)
      }
    }

    const handleScroll = (e?: Event) => {
      scheduleActivity()

      if (document.body.classList.contains("scroll-locked")) {
        return
      }

      if (e?.target) lastScrollContainerRef.current = e.target

      if (!isScrollingRef.current) {
        blurFloatingButtonsIfFocused()
        isScrollingRef.current = true
        setIsScrolling(true)
      }
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
      scrollStopTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false
        setIsScrolling(false)
      }, 150)

      if (scrollRafRef.current != null) return
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null

        const scrollingEl = document.scrollingElement
        const yDocument = Math.max(
          window.scrollY || 0,
          document.documentElement.scrollTop || 0,
          document.body.scrollTop || 0,
          scrollingEl?.scrollTop || 0
        )

        const t = lastScrollContainerRef.current
        const yTarget = t && t !== document && t !== window && t instanceof HTMLElement ? t.scrollTop : 0

        const y = Math.max(yDocument, yTarget)
        const nextShow = y > 320
        setShowBackToTop((prev) => (prev === nextShow ? prev : nextShow))
      })
    }

    const preventMultiTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    const preventGestureZoom = (e: Event) => e.preventDefault()

    scheduleActivity()

    window.addEventListener("mousemove", scheduleActivity, { passive: true })
    window.addEventListener("click", scheduleActivity, { passive: true })
    window.addEventListener("keydown", handleKeyDown)
    document.addEventListener("scroll", handleScroll, { passive: true, capture: true })
    window.addEventListener("scroll", handleScroll, { passive: true })
    document.addEventListener("touchstart", preventMultiTouchZoom, { passive: false })
    document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false })
    document.addEventListener("gesturestart", preventGestureZoom, { passive: false } as AddEventListenerOptions)
    document.addEventListener("gesturechange", preventGestureZoom, { passive: false } as AddEventListenerOptions)

    return () => {
      window.removeEventListener("mousemove", scheduleActivity)
      window.removeEventListener("click", scheduleActivity)
      window.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("scroll", handleScroll as EventListener, true)
      window.removeEventListener("scroll", handleScroll as EventListener)
      document.removeEventListener("touchstart", preventMultiTouchZoom as EventListener)
      document.removeEventListener("touchmove", preventMultiTouchZoom as EventListener)
      document.removeEventListener("gesturestart", preventGestureZoom as EventListener)
      document.removeEventListener("gesturechange", preventGestureZoom as EventListener)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
      if (activityRafRef.current != null) window.cancelAnimationFrame(activityRafRef.current)
      if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  useEffect(() => {
    if (showClock !== undefined) localStorage.setItem("viz_clock", String(showClock))
    if (showSearchBar !== undefined) localStorage.setItem("viz_search", String(showSearchBar))
    if (showSeconds !== undefined) localStorage.setItem("viz_seconds", String(showSeconds))
    if (language) localStorage.setItem("lang_cache", language)
  }, [showClock, showSearchBar, showSeconds, language])

  const handleBackToTop = () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth"

    const t = lastScrollContainerRef.current
    if (t && t !== document && t !== window && t instanceof HTMLElement) {
      t.scrollTo?.({ top: 0, behavior })
      return
    }
    window.scrollTo({ top: 0, behavior })
  }

  const shouldHideSettingsFab = !showSettings && (isIdle || isScrolling)
  const isBackToTopVisible = showBackToTop && !showSettings

  return (
    <ErrorBoundary language={resolvedLanguage}>
      <div className={`main-container ${!isContentReady ? 'content-loading' : ''}`}>
        <div className="layout-section-header">
          <Header enabled={!!showClock} showSeconds={!!showSeconds} language={resolvedLanguage} />
        </div>

        <div className="layout-section-search">
          <SearchBar enabled={!!showSearchBar} />
        </div>

        <QuickLaunch />
      </div>

      <button
        type="button"
        className={`settings-fab soft-out ${!showSettings && isIdle ? "hide-idle" : ""} ${!showSettings && isScrolling ? "hide-scroll" : ""}`}
        onClick={() => setShowSettings(true)}
        ref={settingsFabRef}
        tabIndex={shouldHideSettingsFab ? -1 : 0}
        aria-hidden={shouldHideSettingsFab ? "true" : undefined}
        aria-label={t.openSettings}>
        <FiSettings size={18} />
      </button>

      <button
        type="button"
        className={`back-to-top soft-out ${isBackToTopVisible ? "show" : ""}`}
        onClick={handleBackToTop}
        ref={backToTopRef}
        tabIndex={isBackToTopVisible ? 0 : -1}
        aria-hidden={!isBackToTopVisible ? "true" : undefined}
        aria-label={t.backToTop}>
        <FiArrowUp size={18} />
      </button>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </ErrorBoundary>
  )
}

export default function App() {
  const [language] = useStorage<Language>("language", getInitialLanguage(DEFAULT_SETTINGS.language))

  return (
    <AuthGate language={language || DEFAULT_SETTINGS.language}>
      <NewTabContent />
    </AuthGate>
  )
}
