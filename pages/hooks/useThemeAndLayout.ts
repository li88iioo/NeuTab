import { useEffect, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { DEFAULT_SETTINGS, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import { applyLayoutVariables, applyThemeClasses } from "@neutab/shared/utils/theme"

/**
 * 主题与布局编排
 * @description
 * - 响应 themeMode/visualTheme 变化并驱动 `applyThemeClasses` 同步 DOM(含系统色相监听)
 * - 将布局参数(RAF 节流)分发到根节点 CSS 变量
 * - 返回 isContentReady 供首屏 "content-loading" 缓冲
 */
export const useThemeAndLayout = () => {
  const [themeMode, , { isLoading: themeModeLoading }] = useStorage<ThemeMode>("themeMode", DEFAULT_SETTINGS.themeMode)
  const [visualTheme, , { isLoading: visualThemeLoading }] = useStorage<VisualTheme>("visualTheme", DEFAULT_SETTINGS.visualTheme)

  const [contentMaxWidth, , { isLoading: loadingMaxWidth }] = useStorage("contentMaxWidth", DEFAULT_SETTINGS.contentMaxWidth)
  const [contentPaddingX, , { isLoading: loadingPaddingX }] = useStorage("contentPaddingX", DEFAULT_SETTINGS.contentPaddingX)
  const [contentPaddingTop, , { isLoading: loadingPaddingTop }] = useStorage("contentPaddingTop", DEFAULT_SETTINGS.contentPaddingTop)
  const [contentPaddingBottom, , { isLoading: loadingPaddingBottom }] = useStorage("contentPaddingBottom", DEFAULT_SETTINGS.contentPaddingBottom)
  const [iconBorderRadius, , { isLoading: loadingRadius }] = useStorage("iconBorderRadius", DEFAULT_SETTINGS.iconBorderRadius)
  const [cardSize, , { isLoading: loadingCardSize }] = useStorage("cardSize", DEFAULT_SETTINGS.cardSize)

  const [isContentReady, setIsContentReady] = useState(false)
  const layoutRafRef = useRef<number | null>(null)
  const isInitialLayoutRef = useRef(true)

  const isLayoutLoading = loadingMaxWidth || loadingPaddingX || loadingPaddingTop || loadingPaddingBottom || loadingRadius || loadingCardSize

  /**
   * Effect: 主题应用与同步
   * 处理颜色模式切换,并为下次刷新缓存状态至 localStorage。
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
   * Effect: 布局变量分发
   * 将 Storage 中的布局参数同步到根节点 CSS 变量,RAF 节流保证拖动滑块时流畅。
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

      // 仅在首次布局完成后移除 no-transition 类,防止页面加载时的"布局动画乱跳"
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

  // 布局值仍在加载时保持 content-loading 状态(切勿 setState:直接派生)
  const contentReady = isContentReady && !isLayoutLoading

  return { isContentReady: contentReady }
}
