/**
 * @file theme-early-restore.js
 * @description 极早期的主题恢复脚本，用于在页面加载最开始时防止“闪白”（FOUC）。
 * 
 * 动机：
 * 1. 核心逻辑 `restoreTheme.ts` 随主包加载（通常是 defer 或 module），会在 HTML 渲染后才执行。
 * 2. 如果用户使用的是深色主题，在主包加载前，浏览器默认会渲染一片白色背景。
 * 3. 本脚本通过在 `<head>` 中以阻塞方式加载，尽早读取 `localStorage` 缓存并设置背景色。
 * 
 * 安全与限制：
 * - 为符合插件 CSP 策略，这必须是一个外部脚本文件（禁止内联 JS）。
 * - 必须保持极小体积，且不依赖任何外部库或主包逻辑。
 */

; (function () {
  try {
    // Restore title as early as possible to avoid the "default title flash".
    try {
      var cachedTitle = localStorage.getItem("site_title_cache")
      if (cachedTitle && cachedTitle.trim) {
        var t = String(cachedTitle).trim()
        if (t) document.title = t
      }
    } catch {}

    // 从缓存中同步读取主题和风格配置（由 SettingsPanel 写入）
    var mode = localStorage.getItem("theme_mode_cache") || "auto"
    var visual = localStorage.getItem("visual_theme_cache") || "neumorphic"

    // 检测系统深色模式偏好
    var prefersDark = false
    try {
      prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    } catch { }

    // 计算最终是否应显示为深色
    var isDark = mode === "dark" || (mode === "auto" && prefersDark)

    // 计算背景颜色
    // Liquid-glass (流光玻璃) 支持浅/深两套底色，以保证不同模式下的质感一致且不闪烁
    var bg
    if (visual === "liquid-glass") {
      bg = isDark ? "#050510" : "#f6f7ff"
    } else {
      bg = isDark ? "#292d32" : "#e0e5ec"
    }

    // 立即应用到 HTML 根元素
    if (document.documentElement) {
      document.documentElement.style.backgroundColor = bg
    }

    // 通过注入 <style> 标签确保背景色应用到尚未创建的 <body> 元素上
    var existing = document.getElementById("early-theme-style")
    if (!existing) {
      var style = document.createElement("style")
      style.id = "early-theme-style"
      style.textContent = "html,body{background-color:" + bg + " !important;}"
      document.head && document.head.appendChild(style)
    }

    // 尽早尝试设置浏览器地址栏/标签页颜色
    try {
      var meta = document.querySelector('meta[name="theme-color"]')
      if (!meta && document.head) {
        meta = document.createElement("meta")
        meta.setAttribute("name", "theme-color")
        document.head.appendChild(meta)
      }
      if (meta) meta.setAttribute("content", bg)
    } catch { }
  } catch (err) {
    // 即使出错也不应阻塞页面后续渲染
    console.warn("[theme-early-restore] Failed to restore background early", err)
  }
})()
