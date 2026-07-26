import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiArrowUp, FiSettings } from "react-icons/fi"
import { ErrorBoundary, Header } from "@neutab/ui"
import SearchBar from "~components/search/SearchBar"
import QuickLaunch from "~components/quick-launch/QuickLaunch"
import CloudSyncAgent from "~components/sync/CloudSyncAgent"
import { DEFAULT_SETTINGS } from "@neutab/shared/utils/settings"
import { getTranslations, type Language } from "@neutab/shared/utils/i18n"
import "@neutab/ui/styles/style.css"
import "@neutab/ui/styles/themes/liquid-glass.css"
import { usePageActivity } from "~pages/hooks/usePageActivity"
import { useSiteMetadata } from "~pages/hooks/useSiteMetadata"
import { useThemeAndLayout } from "~pages/hooks/useThemeAndLayout"

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
 * 编排层:聚合可见性/语言/站点元数据状态,主题与布局、活动检测、
 * 站点元数据三块副作用分别下沉到 useThemeAndLayout / usePageActivity / useSiteMetadata。
 */
function NewTab() {
  // -- 主题与布局(含 CSS 变量分发) --
  const { isContentReady } = useThemeAndLayout()

  // -- 组件可见性状态 (配合同步恢复逻辑) --
  const [showSearchBar, , { isLoading: showSearchBarLoading }] = useStorage("showSearchBar", getInitialVisibility("search", DEFAULT_SETTINGS.showSearchBar))
  const [showClock, , { isLoading: showClockLoading }] = useStorage("showClock", getInitialVisibility("clock", DEFAULT_SETTINGS.showClock))
  const [showSeconds] = useStorage("showSeconds", getInitialVisibility("seconds", DEFAULT_SETTINGS.showSeconds))
  const [language] = useStorage<Language>("language", getInitialLanguage(DEFAULT_SETTINGS.language))
  const resolvedLanguage = language || DEFAULT_SETTINGS.language
  const t = getTranslations(resolvedLanguage)

  // -- 站点元数据 --
  const [siteTitle] = useStorage("siteTitle", getInitialSiteTitle(DEFAULT_SETTINGS.siteTitle))
  const [siteFavicon] = useStorage("siteFavicon", DEFAULT_SETTINGS.siteFavicon)
  useSiteMetadata(siteTitle, siteFavicon)

  // -- 本地 UI 状态 --
  const [showSettings, setShowSettings] = useState(false)
  const settingsFabRef = useRef<HTMLButtonElement | null>(null)
  const backToTopRef = useRef<HTMLButtonElement | null>(null)

  const isVisibilityLoading = showSearchBarLoading || showClockLoading

  /**
   * Effect: 可见性类同步
   * 移除 `restoreTheme.ts` 注入的初始化保护类,让 React 接管 DOM。
   */
  useEffect(() => {
    document.body.classList.remove("init-hide-header", "init-hide-search")
    document.body.classList.toggle("hide-search-bar", !showSearchBar)
    document.body.classList.toggle("hide-header", !showClock)
  }, [showSearchBar, showClock, isVisibilityLoading])

  /**
   * Effect: 缓存持久化
   * 将核心状态同步到 localStorage 供 `restoreTheme.ts` 预加载时作为首屏参照。
   */
  useEffect(() => {
    if (showClock !== undefined) localStorage.setItem("viz_clock", String(showClock))
    if (showSearchBar !== undefined) localStorage.setItem("viz_search", String(showSearchBar))
    if (showSeconds !== undefined) localStorage.setItem("viz_seconds", String(showSeconds))
    if (language) localStorage.setItem("lang_cache", language)
  }, [showClock, showSearchBar, showSeconds, language])

  // -- 交互行为管理:沉浸式模式 (Idle) 与返回顶部 --
  const { isIdle, isScrolling, showBackToTop, handleBackToTop } = usePageActivity({
    settingsFabRef,
    backToTopRef,
    onToggleSettings: () => setShowSettings((prev) => !prev)
  })

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
