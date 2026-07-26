import type { ThemeMode, VisualTheme } from "@neutab/shared/utils/settings"

/**
 * 主题/布局 localStorage 缓存
 * @description 供 assets/theme-early-restore.js 在 React 初始化前恢复首屏,消除白屏/主题闪烁。
 * 被 SettingsPanel 各分区与 cloudSync 共用。
 */
export const commitThemeCache = (nextMode: ThemeMode | undefined, nextVisual: VisualTheme | undefined) => {
  try {
    window.localStorage.setItem("theme_mode_cache", nextMode || "auto")
    window.localStorage.setItem("visual_theme_cache", nextVisual || "neumorphic")
  } catch {
    // 忽略隐私模式下的存储错误
  }
}

export const commitLayoutCache = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 忽略隐私模式下的存储错误
  }
}
