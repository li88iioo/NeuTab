/**
 * @file restoreTheme.ts
 * @description 同步执行的主题/布局恢复逻辑。
 *
 * 目标：
 * - 在 React/Plasmo Storage 异步加载前，先用 localStorage 的缓存值恢复「主题/布局/显隐」，
 *   以避免首屏白闪与布局跳动。
 */

import type { ThemeMode, VisualTheme } from "../utils/settings"
import { applyLayoutVariables, applyThemeClasses } from "../utils/theme"

const readCachedNumberString = (key: string): string | undefined => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * 执行同步主题恢复
 * @description 
 * 1. 读取主题色模式和视觉风格缓存。
 * 2. 根据系统偏好计算是否为深色模式。
 * 3. 立即应用 CSS 类到 body（dark, liquid-glass, performance-mode）。
 * 4. 同步恢复布局相关的 CSS 变量，确保卡片尺寸、内边距等不产生布局抖动。
 * 5. 立即设置 HTML 和 Body 背景色。
 * 6. 应用组件可见性缓存，防止已设置隐藏的搜索栏或时钟短暂闪现。
 */
export const restoreTheme = () => {
  try {
    // 禁止初始动画（React 首次完成布局后会移除）
    document.body.classList.add("no-transition")

    // 1. 读取主题配置
    const cachedMode = localStorage.getItem("theme_mode_cache") as ThemeMode | null
    const cachedVisual = localStorage.getItem("visual_theme_cache") as VisualTheme | null

    const mode = cachedMode || "auto"
    const visual = cachedVisual || "neumorphic"

    // 2. 应用主题类（保留 head 阻塞脚本注入的 early style，避免 CSS 未加载时闪白）
    applyThemeClasses(mode, visual, { cleanupEarlyFallback: false })

    // 3. 布局变量同步恢复 (防止布局跳动)
    applyLayoutVariables({
      contentMaxWidth: readCachedNumberString("layout_contentMaxWidth"),
      contentPaddingX: readCachedNumberString("layout_contentPaddingX"),
      contentPaddingTop: readCachedNumberString("layout_contentPaddingTop"),
      contentPaddingBottom: readCachedNumberString("layout_contentPaddingBottom"),
      iconBorderRadius: readCachedNumberString("layout_iconBorderRadius"),
      cardSize: readCachedNumberString("layout_cardSize")
    })

    // 4. 组件可见性恢复 (FOUC 保护)
    const vizClock = localStorage.getItem("viz_clock")
    const vizSearch = localStorage.getItem("viz_search")

    // 如果用户设置了隐藏，通过 init-hide 类名在 CSS 加载前就隐藏对应区域
    if (vizClock === "false") {
      document.body.classList.add("init-hide-header")
    }

    if (vizSearch === "false") {
      document.body.classList.add("init-hide-search")
    }

  } catch (err) {
    console.warn("[restoreTheme] Failed to restore theme synchronously", err)
  }
}

// 立即运行
restoreTheme()
