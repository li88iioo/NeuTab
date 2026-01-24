/**
 * @file preloadTheme.ts
 * @description 主题与布局预加载脚本。
 * 
 * 执行时机：在 React 挂载前立即执行。
 * 核心目标：
 * 1. 彻底解决 Chrome 扩展由于异步存储加载导致的“闪光弹”（Flash of Unstyled Content）问题。
 * 2. 在页面渲染前，将存储中的设置同步到 `document.body` 的类名和 CSS 变量中。
 */

import { Storage } from "@plasmohq/storage"
import { applyLayoutVariables, applyThemeClasses } from "~utils/theme"
import type { ThemeMode, VisualTheme } from "~utils/settings"

const storage = new Storage()

/**
 * 预加载并应用主题和布局
 * @description
 * `restoreTheme.ts` 已负责在最早期用 localStorage 同步恢复首屏（避免闪白/跳动）。
 * 这里负责从 `chrome.storage` 异步读取“最终真值”，并更新缓存与 DOM：
 * - 批量读取 (getMany) 以减少 IPC 开销
 * - 更新 localStorage 缓存供下次同步恢复使用
 * - 应用精准的布局变量（宽度、间距、圆角等）到 CSS 变量
 * - 根据可见性设置，通过 CSS 类控制组件（如搜索栏、时钟）的初始显隐状态，防止布局闪变
 */
export const preloadTheme = async () => {
	try {
		// ----------------------------------------------------
		// Async Source of Truth
		// ----------------------------------------------------
		// 从 Chrome Storage 读取所有设置 (这是最准确的数据)
		// 关键路径：避免串行 await 叠加延迟，尽量批量读取。
		const values = await storage.getMany([
			"visualTheme",
			"themeMode",
			"language",
			"contentMaxWidth",
			"contentPaddingX",
			"contentPaddingTop",
			"contentPaddingBottom",
			"iconBorderRadius",
			"cardSize",
			"showSearchBar",
			"showClock"
		]) as Record<string, any>

		const visualTheme = values.visualTheme as VisualTheme | undefined
		const themeMode = values.themeMode as ThemeMode | undefined
		const language = values.language as string | undefined
		const contentMaxWidth = values.contentMaxWidth as number | undefined
		const contentPaddingX = values.contentPaddingX as number | undefined
		const contentPaddingTop = values.contentPaddingTop as number | undefined
		const contentPaddingBottom = values.contentPaddingBottom as number | undefined
		const iconBorderRadius = values.iconBorderRadius as number | undefined
		const cardSize = values.cardSize as number | undefined
		const showSearchBar = values.showSearchBar as boolean | undefined
		const showClock = values.showClock as boolean | undefined

		// 更新缓存，供下次加载使用
		localStorage.setItem("theme_mode_cache", themeMode || "auto")
		localStorage.setItem("visual_theme_cache", visualTheme || "neumorphic")
		if (language === "en" || language === "zh") {
			localStorage.setItem("lang_cache", language)
		}

		// Cache layout settings to localStorage for synchronous restore
		if (typeof contentMaxWidth === "number") localStorage.setItem("layout_contentMaxWidth", String(contentMaxWidth))
		if (typeof contentPaddingX === "number") localStorage.setItem("layout_contentPaddingX", String(contentPaddingX))
		if (typeof contentPaddingTop === "number") localStorage.setItem("layout_contentPaddingTop", String(contentPaddingTop))
		if (typeof contentPaddingBottom === "number") localStorage.setItem("layout_contentPaddingBottom", String(contentPaddingBottom))
		if (typeof iconBorderRadius === "number") localStorage.setItem("layout_iconBorderRadius", String(iconBorderRadius))
		if (typeof cardSize === "number") localStorage.setItem("layout_cardSize", String(cardSize))

		// 预加载可见性设置 (防止闪烁)
		if (showSearchBar === false) document.body.classList.add("hide-search-bar")
		if (showClock === false) document.body.classList.add("hide-header")

		// 使用共享工具类应用主题
		applyThemeClasses(themeMode, visualTheme, { cleanupEarlyFallback: false })

		// 使用共享工具类应用布局
		applyLayoutVariables({
			contentMaxWidth,
			contentPaddingX,
			contentPaddingTop,
			contentPaddingBottom,
			iconBorderRadius,
			cardSize
		})

		// 添加标记表示主题已预加载
		document.body.setAttribute("data-theme-preloaded", "true")
	} catch (error) {
		console.warn("Theme preload failed:", error)
		// 失败时使用默认主题，不影响页面加载
	}
}

// 立即执行预加载
preloadTheme()
