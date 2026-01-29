import { DEFAULT_SETTINGS, LAYOUT_LIMITS, type ThemeMode, type VisualTheme } from "./settings"

/**
 * 性能模式探测
 * @description 根据用户系统配置（减少动画）或硬件规格（内存/核心数）判断是否启用简化版视觉效果。
 */
const shouldEnablePerformanceMode = (): boolean => {
    try {
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
        const hardwareConcurrency = navigator.hardwareConcurrency
        const lowEnd =
            (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory <= 4) ||
            (typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= 4)
        return prefersReducedMotion || lowEnd
    } catch {
        return false
    }
}

/**
 * 清除白闪防御样式
 * @description `restoreTheme.ts` 和 HTML 模板中注入了临时样式以防止暗色模式下的瞬间白闪。
 * 当 React 接管并完成首次主题应用后，必须移除这些样式，否则会干扰后续的主题实时切换。
 */
const cleanupEarlyThemeFallback = () => {
    try {
        document.getElementById("early-theme-style")?.remove()
        document.getElementById("early-theme-fallback-style")?.remove()
    } catch {
        // ignore
    }
}

let themeSwitchRaf: number | null = null
let themeSwitchRaf2: number | null = null

const markThemeSwitching = () => {
    document.body.classList.add("theme-switching")
    if (themeSwitchRaf !== null) cancelAnimationFrame(themeSwitchRaf)
    if (themeSwitchRaf2 !== null) cancelAnimationFrame(themeSwitchRaf2)
    themeSwitchRaf = requestAnimationFrame(() => {
        themeSwitchRaf2 = requestAnimationFrame(() => {
            document.body.classList.remove("theme-switching")
            themeSwitchRaf = null
            themeSwitchRaf2 = null
        })
    })
}

/**
 * 应用视觉主题和深浅色模式类
 * @description 同步修改 `document.body` 的 class，并处理液态玻璃主题的特殊内联样式和性能降级。
 * @param themeMode 颜色模式 (auto, light, dark)
 * @param visualTheme 视觉风格 (neumorphic, liquid-glass)
 */
export const applyThemeClasses = (
    themeMode: ThemeMode | "auto" | undefined,
    visualTheme: VisualTheme | undefined,
    opts?: { cleanupEarlyFallback?: boolean }
) => {
    const mode = themeMode ?? DEFAULT_SETTINGS.themeMode
    const theme = visualTheme ?? DEFAULT_SETTINGS.visualTheme

    // 计算当前是否应为深色模式
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    let isDark = false

    if (mode === "dark") {
        isDark = true
    } else if (mode === "light") {
        isDark = false
    } else {
        isDark = prefersDark
    }

    // Only add `theme-switching` when a *real* theme result changes.
    // Calling `applyThemeClasses()` multiple times during boot (restoreTheme/preloadTheme/React effect)
    // should NOT temporarily remove shadows, otherwise the SearchBar `.soft-in` shadow "flashes".
    const nextKey = `${mode}|${theme}|${isDark ? "1" : "0"}`
    const prevKey = (globalThis as any).__NEUTAB_THEME_KEY__ as string | undefined
    const isBooting = document.body.classList.contains("no-transition")

    if (!isBooting && prevKey && prevKey !== nextKey) {
        markThemeSwitching()
    }
    ;(globalThis as any).__NEUTAB_THEME_KEY__ = nextKey

    // 应用深色模式 Class
    if (isDark) {
        document.body.classList.add("dark")
    } else {
        document.body.classList.remove("dark")
    }

    // 清理视觉主题类
    document.body.classList.remove("liquid-glass", "neumorphic")
    document.body.classList.remove("performance-mode")

    // 处理液态玻璃主题的特殊逻辑
    if (theme === "liquid-glass") {
        document.body.classList.add("liquid-glass")
        if (shouldEnablePerformanceMode()) {
            document.body.classList.add("performance-mode")
        }

        // 强制背景色，确保混合模式 (mix-blend-mode) 在 React 渲染期间表现稳定
        // Keep the browser chrome + early paints consistent with the active liquid-glass palette.
        const rootBg = isDark ? "#050510" : "#f6f7ff"
        document.body.style.backgroundColor = rootBg
        document.documentElement.style.backgroundColor = rootBg

        // 同步修改浏览器 UI 颜色 (如 Android 地址栏、iOS 工具栏)
        updateThemeColorMeta(rootBg)
    } else {
        // 标准新拟态模式，清除内联背景色使用 CSS 变量控制
        document.body.style.backgroundColor = ""
        document.documentElement.style.backgroundColor = ""

        const defaultBg = isDark ? "#292d32" : "#e0e5ec"
        updateThemeColorMeta(defaultBg)
    }

    // Keep early blocking/fallback styles until the app has fully loaded if requested.
    if (opts?.cleanupEarlyFallback !== false) {
        cleanupEarlyThemeFallback()
    }
}

/**
 * 更新或创建 <meta name="theme-color"> 标签
 * @param color 十六进制颜色值
 */
const updateThemeColorMeta = (color: string) => {
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute('name', 'theme-color')
        document.head.appendChild(meta)
    }
    meta.setAttribute('content', color)
}

/**
 * 将布局配置应用到 CSS 全局变量
 * @description 
 * 此函数负责实现“响应式参数化设计”，将数值转换为 CSS Custom Properties。
 * 包含复杂的阴影缩放算法，确保卡片在各种尺寸下都具备良好的新拟态质感。
 * 
 * @param settings 布局配置项（支持数字或字符串，包含容错处理）
 */
export const applyLayoutVariables = (settings: {
    contentMaxWidth?: number | string
    contentPaddingX?: number | string
    contentPaddingTop?: number | string
    contentPaddingBottom?: number | string
    iconBorderRadius?: number | string
    cardSize?: number | string
}) => {
    const root = document.documentElement

    const maxWidth = Number(settings.contentMaxWidth ?? DEFAULT_SETTINGS.contentMaxWidth)
    const paddingX = Math.max(
        LAYOUT_LIMITS.paddingX.min,
        Number(settings.contentPaddingX ?? DEFAULT_SETTINGS.contentPaddingX)
    )
    const paddingTop = Number(settings.contentPaddingTop ?? DEFAULT_SETTINGS.contentPaddingTop)
    const paddingBottom = Number(settings.contentPaddingBottom ?? DEFAULT_SETTINGS.contentPaddingBottom)
    const radius = Number(settings.iconBorderRadius ?? DEFAULT_SETTINGS.iconBorderRadius)
    const size = Number(settings.cardSize ?? DEFAULT_SETTINGS.cardSize)

    // 基本尺寸变量
    root.style.setProperty("--content-max-width", `${maxWidth}px`)
    root.style.setProperty("--content-padding-x", `${paddingX}px`)
    root.style.setProperty("--content-padding-top", `${paddingTop}px`)
    root.style.setProperty("--content-padding-bottom", `${paddingBottom}px`)
    root.style.setProperty("--card-radius", `${radius}%`)
    root.style.setProperty("--card-size", `${size}px`)

    // 计算缩放系数，用于 CSS `transform: scale(...)` 配合，避免重复计算像素
    root.style.setProperty("--card-scale", String(size / 110))

    // 计算动态间距
    const cardGap = Math.max(20, Math.round(size * 0.22))
    root.style.setProperty("--card-gap", `${cardGap}px`)

    // Make "side padding" changes visually perceptible by subtly scaling the icon grid with paddingX.
    // This keeps layout responsive even when column count doesn't change.
    const padDelta = paddingX - DEFAULT_SETTINGS.contentPaddingX
    const gridScale = Math.max(0.75, Math.min(1.15, 1 - padDelta / 500))
    const gridSize = Math.round(size * gridScale * 100) / 100
    root.style.setProperty("--grid-card-size", `${gridSize}px`)
    root.style.setProperty("--grid-card-scale", String(gridSize / 110))
    const gridGap = Math.max(12, Math.round(gridSize * 0.22))
    root.style.setProperty("--grid-card-gap", `${gridGap}px`)

    // -- 关键优化：非线性阴影缩放 --
    // 为了使 UI 更有质感，阴影不能随尺寸线性等比缩放。
    // 使用 pow(scale, 1.3) 指数让小尺寸卡片的阴影衰减更快、更柔和，防止在小尺寸产生沉重的“黑边感”。
    const shadowScale = Math.pow(size / 110, 1.3)
    const shadowOffset = Math.max(3, Math.round(8 * shadowScale))
    const shadowBlur = Math.max(6, Math.round(16 * shadowScale))
    const shadowOffsetIn = Math.max(2, Math.round(6 * shadowScale))
    const shadowBlurIn = Math.max(4, Math.round(10 * shadowScale))

    root.style.setProperty("--shadow-offset", `${shadowOffset}px`)
    root.style.setProperty("--shadow-blur", `${shadowBlur}px`)
    root.style.setProperty("--shadow-offset-in", `${shadowOffsetIn}px`)
    root.style.setProperty("--shadow-blur-in", `${shadowBlurIn}px`)
}
