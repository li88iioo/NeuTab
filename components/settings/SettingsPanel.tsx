import React, { useEffect, useRef } from "react"
import { useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  FiDatabase, FiGlobe, FiGrid, FiHome, FiLayout, FiMonitor, FiMoon, FiSliders, FiSun, FiX
} from "react-icons/fi"
import { DEFAULT_SETTINGS, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import { getTranslations } from "@neutab/shared/utils/i18n"
import { lockBodyScroll } from "@neutab/shared/utils/scrollLock"
import { commitThemeCache } from "~utils/uiCache"
import PersonalizationSection from "./sections/PersonalizationSection"
import LayoutSection from "./sections/LayoutSection"
import SiteSection from "./sections/SiteSection"
import GroupsSection from "./sections/GroupsSection"
import BackupSection from "./sections/BackupSection"
import "./SettingsPanel.css"

interface SettingsPanelProps {
  onClose: () => void
}

type SectionKey = "personalization" | "layout" | "site" | "groups" | "backup"

/**
 * 设置面板(壳组件)
 * @description
 * 只负责面板框架:遮罩、导航、主题/语言快捷切换、焦点陷阱与 Esc 关闭。
 * 五个分区各自为独立组件,仅在激活时挂载——各分区的 useStorage 订阅
 * 不会在面板打开时全量运行,降低无关 storage 变更引起的重渲染。
 */
const SettingsPanel = ({ onClose }: SettingsPanelProps) => {
  // 壳层只订阅跨分区共享的三个键(顶部工具栏 + 传给分区)
  const [themeMode, setThemeMode] = useStorage<ThemeMode>("themeMode", DEFAULT_SETTINGS.themeMode)
  const [visualTheme, setVisualTheme] = useStorage<VisualTheme>("visualTheme", DEFAULT_SETTINGS.visualTheme)
  const [language, setLanguage] = useStorage("language", DEFAULT_SETTINGS.language)

  const [activeSection, setActiveSection] = useState<SectionKey>("site")

  const settingsPanelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const t = getTranslations(language || "zh")

  /**
   * Effect: 面板开启时的交互优化
   * 1. 锁定 Body 滚动并补偿滚动条宽度,防止背景页面抖动。
   * 2. 焦点陷阱 + 关闭后焦点返还。
   * 3. Esc 快捷键关闭。
   */
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement

    const unlockScroll = lockBodyScroll()
    const getFocusableElements = () => Array.from(
      settingsPanelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) || []
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusable = getFocusableElements()
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    requestAnimationFrame(() => getFocusableElements()[0]?.focus())
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      unlockScroll()
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
    }
  }, [onClose])

  /** 循环切换主题颜色模式:自动 -> 浅色 -> 深色 */
  const cycleTheme = () => {
    const modes: ThemeMode[] = ["auto", "light", "dark"]
    const currentIndex = modes.indexOf(themeMode || "auto")
    const nextMode = modes[(currentIndex + 1) % modes.length]
    commitThemeCache(nextMode, visualTheme || "neumorphic")
    void setThemeMode(nextMode)
  }

  const getThemeIcon = () => {
    switch (themeMode) {
      case "light": return <FiSun size={18} />
      case "dark": return <FiMoon size={18} />
      default: return <FiMonitor size={18} />
    }
  }

  const getThemeLabel = () => {
    const modeLabel = (() => {
      switch (themeMode) {
        case "light": return t.themeLight
        case "dark": return t.themeDark
        default: return t.themeAuto
      }
    })()
    return `${t.themePrefix}: ${modeLabel}`
  }

  /** 切换中英文环境 */
  const cycleLanguage = () => {
    setLanguage(language === "zh" ? "en" : "zh")
  }

  const getLanguageLabel = () => {
    const langName = language === "en" ? "English" : "中文"
    return `${t.language}: ${langName}`
  }

  /** 侧边导航栏配置 */
  const sections: { key: SectionKey; label: string; iconClass: string; icon: React.ReactNode }[] = [
    { key: "site", label: t.site, iconClass: "icon-site", icon: <FiHome size={16} /> },
    { key: "personalization", label: t.personalization, iconClass: "icon-personalization", icon: <FiSliders size={16} /> },
    { key: "layout", label: t.layout, iconClass: "icon-layout", icon: <FiLayout size={16} /> },
    { key: "groups", label: t.groups, iconClass: "icon-groups", icon: <FiGrid size={16} /> },
    { key: "backup", label: t.backup, iconClass: "icon-backup", icon: <FiDatabase size={16} /> }
  ]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div ref={settingsPanelRef} className="settings-panel soft-out" role="dialog" aria-modal="true" aria-label={t.settings} onClick={(e) => e.stopPropagation()}>
        {/* 面板头部:包含分类导航与快捷工具栏 */}
        <div className="settings-header">
          <div className="settings-top-nav-wrap">
            <nav className="settings-top-nav" aria-label={t.settings}>
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={`settings-top-nav-btn soft-out ${activeSection === section.key ? "active" : ""}`}
                  onClick={() => setActiveSection(section.key)}
                  title={section.label}
                  aria-label={section.label}
                  aria-current={activeSection === section.key ? "page" : undefined}>
                  <span className={`nav-icon ${section.iconClass}`}>{section.icon}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="settings-header-right">
            <button
              type="button"
              className="settings-lang-btn soft-out"
              onClick={cycleLanguage}
              title={getLanguageLabel()}>
              <FiGlobe size={18} />
            </button>
            <button
              type="button"
              className="settings-theme-btn soft-out"
              onClick={cycleTheme}
              title={getThemeLabel()}>
              {getThemeIcon()}
            </button>
            <button type="button" className="settings-close soft-out" onClick={onClose} aria-label={t.settings}>
              <FiX size={18} />
            </button>
          </div>
        </div>

        <div className="settings-body">
          <div className="settings-content">
            {activeSection === "personalization" && (
              <PersonalizationSection
                t={t}
                themeMode={themeMode}
                visualTheme={visualTheme}
                setVisualTheme={setVisualTheme}
              />
            )}
            {activeSection === "layout" && <LayoutSection t={t} />}
            {activeSection === "site" && <SiteSection t={t} />}
            {activeSection === "groups" && <GroupsSection t={t} />}
            {activeSection === "backup" && <BackupSection t={t} language={language} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
