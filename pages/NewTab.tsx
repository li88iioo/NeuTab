import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiArrowUp, FiSettings } from "react-icons/fi"
import { ErrorBoundary, Header } from "@neutab/ui"
import SearchBar from "~components/search/SearchBar"
import QuickLaunch from "~components/quick-launch/QuickLaunch"
import CloudSyncAgent from "~components/sync/CloudSyncAgent"
import { DEFAULT_SETTINGS, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import { getTranslations, type Language } from "@neutab/shared/utils/i18n"
import "@neutab/ui/styles/style.css"
import "@neutab/ui/styles/themes/liquid-glass.css"
import { applyLayoutVariables, applyThemeClasses } from "@neutab/shared/utils/theme"
import { beginPerfInteracting } from "@neutab/shared/utils/perfLod"
import { sanitizeUrl } from "@neutab/shared/utils/validation"

const SettingsPanel = lazy(() => import("~components/settings/SettingsPanel"))

// 同步读取 localStorage 避免闪烁
/**
 * 同步从 localStorage 读取显示状态
 * @description 
 * 用于解决 Plasmo Storage 异步读取在首屏产生的布局跳动 (Layout Jitter)。
 * 配合 `restoreTheme.ts` 在 React 初始化前将状态注入 body class。
 * @param key 存储键名
 * @param defaultValue 默认值
 */
const getInitialVisibility = (key: string, defaultValue: boolean): boolean => {
  try {
    const cached = localStorage.getItem(`viz_${key}`)
    return cached === null ? defaultValue : cached === "true"
  } catch {
    return defaultValue
  }
}

/**
 * 同步从 localStorage 读取语言配置
 * @param defaultValue 默认值
 */
const getInitialLanguage = (defaultValue: Language): Language => {
  try {
    const cached = localStorage.getItem("lang_cache")
    return cached === "en" || cached === "zh" ? cached : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Sync read cached site title to avoid a "default title flash" before Storage is ready.
 */
const getInitialSiteTitle = (defaultValue: string): string => {
  try {
    const cached = localStorage.getItem("site_title_cache")
    if (!cached) return defaultValue
    const t = cached.trim()
    return t ? t : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * NewTab 主入口页面组件
 * @description 
 * 核心职责：
 * 1. 状态聚合：管理主题、语言、布局参数、组件可见性等全局持久化状态。
 * 2. 主题编排：实时响应系统色相变化，并驱动 `applyThemeClasses` 同步 DOM 状态。
 * 3. 布局分发：将存储中的数值同步至 CSS 变量，驱动全站响应式设计。
 * 4. 交互增强：实现用户活动检测（Idle 模式）、滚动管理（返回顶部）、以及核心组件的渲染。
 * 5. 性能优化：通过 `lazy` 懒加载非首屏组件（SettingsPanel），减少 bundle 体积。
 */
function NewTab() {
  // -- 主题与视觉状态 --
  const [themeMode, , { isLoading: themeModeLoading }] = useStorage<ThemeMode>("themeMode", DEFAULT_SETTINGS.themeMode)
  const [visualTheme, , { isLoading: visualThemeLoading }] = useStorage<VisualTheme>("visualTheme", DEFAULT_SETTINGS.visualTheme)

  // -- 组件可见性状态 (配合同步恢复逻辑) --
  const [showSearchBar, , { isLoading: showSearchBarLoading }] = useStorage("showSearchBar", getInitialVisibility("search", DEFAULT_SETTINGS.showSearchBar))
  const [showClock, , { isLoading: showClockLoading }] = useStorage("showClock", getInitialVisibility("clock", DEFAULT_SETTINGS.showClock))
  const [showSeconds] = useStorage("showSeconds", getInitialVisibility("seconds", DEFAULT_SETTINGS.showSeconds))
  const [language] = useStorage<Language>("language", getInitialLanguage(DEFAULT_SETTINGS.language))
  const resolvedLanguage = language || DEFAULT_SETTINGS.language
  const t = getTranslations(resolvedLanguage)

  // -- 布局精细控制参数 --
  const [contentMaxWidth, , { isLoading: loadingMaxWidth }] = useStorage("contentMaxWidth", DEFAULT_SETTINGS.contentMaxWidth)
  const [contentPaddingX, , { isLoading: loadingPaddingX }] = useStorage("contentPaddingX", DEFAULT_SETTINGS.contentPaddingX)
  const [contentPaddingTop, , { isLoading: loadingPaddingTop }] = useStorage("contentPaddingTop", DEFAULT_SETTINGS.contentPaddingTop)
  const [contentPaddingBottom, , { isLoading: loadingPaddingBottom }] = useStorage("contentPaddingBottom", DEFAULT_SETTINGS.contentPaddingBottom)
  const [iconBorderRadius, , { isLoading: loadingRadius }] = useStorage("iconBorderRadius", DEFAULT_SETTINGS.iconBorderRadius)
  const [cardSize, , { isLoading: loadingCardSize }] = useStorage("cardSize", DEFAULT_SETTINGS.cardSize)

  // -- 站点元数据 --
  const [siteTitle] = useStorage("siteTitle", getInitialSiteTitle(DEFAULT_SETTINGS.siteTitle))
  const [siteFavicon] = useStorage("siteFavicon", DEFAULT_SETTINGS.siteFavicon)

  // -- 本地 UI 状态 --
  const [showSettings, setShowSettings] = useState(false)
  const defaultTitleRef = useRef<string | null>(null)
  const defaultFaviconRef = useRef<string | null>(null)

  // 标志位：内容是否准备就绪（用于给首屏布局/变量分发留出缓冲，避免“加载时闪一下”）。
  const [isContentReady, setIsContentReady] = useState(false)
  const layoutRafRef = useRef<number | null>(null)
  const isInitialLayoutRef = useRef(true)

  // 聚合加载状态以防止在 Storage 预热期间产生错误覆写
  const isLayoutLoading = loadingMaxWidth || loadingPaddingX || loadingPaddingTop || loadingPaddingBottom || loadingRadius || loadingCardSize
  const isVisibilityLoading = showSearchBarLoading || showClockLoading

  // When layout values are still loading, keep the "content-loading" class active.
  useEffect(() => {
    if (isLayoutLoading) setIsContentReady(false)
  }, [isLayoutLoading])

  /**
   * Effect: 主题应用与同步
   * 处理颜色模式切换，并为下次刷新缓存状态至 localStorage。
   */
  useEffect(() => {
    if (themeModeLoading || visualThemeLoading) return

    applyThemeClasses(themeMode, visualTheme)

    // 更新缓存用于预加载脚本
    localStorage.setItem("theme_mode_cache", themeMode || "auto")
    localStorage.setItem("visual_theme_cache", visualTheme || "neumorphic")

    // 监听系统深色模式变化 (仅在 auto 模式下)
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      if (themeMode === "auto") {
        applyThemeClasses("auto", visualTheme)
      }
    }
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [themeMode, visualTheme, themeModeLoading, visualThemeLoading])

  /**
   * Effect: 可见性类同步
   * 移除 `restoreTheme.ts` 注入的初始化保护类，让 React 接管 DOM。
   */
  useEffect(() => {
    document.body.classList.remove("init-hide-header", "init-hide-search")
    document.body.classList.toggle("hide-search-bar", !showSearchBar)
    document.body.classList.toggle("hide-header", !showClock)
  }, [showSearchBar, showClock, isVisibilityLoading])

  /**
   * Effect: 布局变量分发
   * 将 Storage 中的布局参数同步到 document 根节点的 CSS 变量中。
   * 使用 RAF 节流以保证在拖动设置滑块时的流畅度。
   */
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

      // 仅在首次布局完成后移除 no-transition 类，防止页面加载时的“布局动画乱跳”
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

  /**
   * Effect: 动态更新网页标题
   */
  useEffect(() => {
    if (defaultTitleRef.current === null) {
      defaultTitleRef.current = document.title
    }
    const title = siteTitle.trim() || defaultTitleRef.current || ""
    if (title) document.title = title
    try {
      if (title) localStorage.setItem("site_title_cache", title)
    } catch {
      // ignore
    }
  }, [siteTitle])

  /**
   * Effect: 动态更新 Favicon
   */
  useEffect(() => {
    if (defaultFaviconRef.current === null) {
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      defaultFaviconRef.current = existing?.href ?? null
    }
    const faviconValue = siteFavicon.trim()
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

  // -- 交互行为管理：沉浸式模式 (Idle) 与返回顶部 --
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
  const scrollPerfReleaseRef = useRef<(() => void) | null>(null)
  const scrollPerfStartRef = useRef(0)
  const scrollPerfReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    /** 辅助函数：当按钮即将隐藏时移除焦点，防止 aria-hidden 与 focus 产生冲突 */
    const blurFloatingButtonsIfFocused = () => {
      const active = document.activeElement
      if (active === settingsFabRef.current || active === backToTopRef.current) {
        ; (active as HTMLElement).blur()
      }
    }

    /** 活动调度器：通过 RAF 合并高频事件回调，提高性能 */
    const scheduleActivity = () => {
      if (activityRafRef.current != null) return
      activityRafRef.current = window.requestAnimationFrame(() => {
        activityRafRef.current = null
        setIsIdle((prev) => (prev ? false : prev))

        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => {
          blurFloatingButtonsIfFocused()
          setIsIdle(true)
        }, 3000) // 3秒无操作进入闲置模式
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      scheduleActivity()
      // 快捷键 's' 打开设置面板 (排除非输入框状态)
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

      if (scrollPerfReleaseTimerRef.current) {
        clearTimeout(scrollPerfReleaseTimerRef.current)
        scrollPerfReleaseTimerRef.current = null
      }

      // 滚动时临时隐藏悬浮按钮，减少视觉干扰并防止误触
      if (!isScrollingRef.current) {
        blurFloatingButtonsIfFocused()
        isScrollingRef.current = true
        setIsScrolling(true)
        scrollPerfReleaseRef.current?.()
        scrollPerfReleaseRef.current = beginPerfInteracting()
        scrollPerfStartRef.current = performance.now()
      }
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
      scrollStopTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false
        setIsScrolling(false)
        const MIN_HOLD_MS = 280
        const elapsed = performance.now() - scrollPerfStartRef.current
        const remaining = Math.max(0, MIN_HOLD_MS - elapsed)
        if (remaining > 0) {
          scrollPerfReleaseTimerRef.current = setTimeout(() => {
            scrollPerfReleaseTimerRef.current = null
            scrollPerfReleaseRef.current?.()
            scrollPerfReleaseRef.current = null
          }, remaining)
        } else {
          scrollPerfReleaseRef.current?.()
          scrollPerfReleaseRef.current = null
        }
      }, 220)

      // 返回顶部显隐：兼容 window scroll 和任意可滚动容器（scroll 事件不冒泡）
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

    // Prevent pinch-zoom on mobile/touch devices while keeping normal scrolling.
    // (Some Chromium-based mobile browsers ignore `touch-action` for pinch gestures.)
    const preventMultiTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    const preventGestureZoom = (e: Event) => e.preventDefault()

    // 默认执行一次
    scheduleActivity()

    // 全局事件监听
    window.addEventListener("mousemove", scheduleActivity, { passive: true })
    window.addEventListener("click", scheduleActivity, { passive: true })
    window.addEventListener("keydown", handleKeyDown)
    // Capture scroll from any scroll container + window scroll for compatibility.
    document.addEventListener("scroll", handleScroll, { passive: true, capture: true })
    window.addEventListener("scroll", handleScroll, { passive: true })
    document.addEventListener("touchstart", preventMultiTouchZoom, { passive: false })
    document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false })
    // iOS Safari family (some WebViews) uses gesture events.
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
      if (scrollPerfReleaseTimerRef.current) clearTimeout(scrollPerfReleaseTimerRef.current)
      if (activityRafRef.current != null) window.cancelAnimationFrame(activityRafRef.current)
      if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current)
      scrollPerfReleaseRef.current?.()
      scrollPerfReleaseRef.current = null
      scrollPerfReleaseTimerRef.current = null
    }
  }, [])

  /**
   * Effect: 缓存持久化
   * 定期将核心状态同步到 localStorage 供 `restoreTheme.ts` 预加载时作为首屏参照。
   */
  useEffect(() => {
    if (showClock !== undefined) localStorage.setItem("viz_clock", String(showClock))
    if (showSearchBar !== undefined) localStorage.setItem("viz_search", String(showSearchBar))
    if (showSeconds !== undefined) localStorage.setItem("viz_seconds", String(showSeconds))
    if (language) localStorage.setItem("lang_cache", language)
  }, [showClock, showSearchBar, showSeconds, language])

  /** 执行回顶部 */
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

  // 悬浮按钮显隐逻辑判定
  const shouldHideSettingsFab = !showSettings && (isIdle || isScrolling)
  const isBackToTopVisible = showBackToTop && !showSettings

  return (
    <ErrorBoundary language={resolvedLanguage}>
      <CloudSyncAgent />
      <div className={`main-container ${!isContentReady ? 'content-loading' : ''}`}>
        <div className="layout-section-header">
          <Header enabled={!!showClock} showSeconds={!!showSeconds} language={resolvedLanguage} />
        </div>

        <div className="layout-section-search">
          <SearchBar enabled={!!showSearchBar} />
        </div>

        <QuickLaunch />
      </div>

      {/* 设置齿轮:沉浸模式下自动变淡/消失 */}
      <button
        type="button"
        className={`settings-fab soft-out ${!showSettings && isIdle ? "hide-idle" : ""} ${!showSettings && isScrolling ? "hide-scroll" : ""}`}
        onClick={() => setShowSettings(true)}
        ref={settingsFabRef}
        tabIndex={shouldHideSettingsFab ? -1 : 0}
        aria-hidden={shouldHideSettingsFab ? "true" : undefined}
        inert={shouldHideSettingsFab ? "" : undefined}
        aria-label={t.openSettings}>
        <FiSettings size={18} />
      </button>

      {/* 返回顶部:滚过阈值后显示 */}
      <button
        type="button"
        className={`back-to-top soft-out ${isBackToTopVisible ? "show" : ""}`}
        onClick={handleBackToTop}
        ref={backToTopRef}
        tabIndex={isBackToTopVisible ? 0 : -1}
        aria-hidden={!isBackToTopVisible ? "true" : undefined}
        inert={!isBackToTopVisible ? "" : undefined}
        aria-label={t.backToTop}>
        <FiArrowUp size={18} />
      </button>

      {/* 设置面板 */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
    </ErrorBoundary>
  )
}

export default NewTab
