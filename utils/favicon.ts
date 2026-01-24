/**
 * @file favicon.ts
 * @description 跨浏览器的图标 (Favicon) 获取工具。
 * 
 * 核心逻辑：
 * 1. **Chromium 系浏览器**：利用 MV3 提供的内部 `_favicon` 服务。
 *    - 优势：速度极快，且能有效获取许多内部或复杂路由站点的图标。
 *    - 前提：需在 `manifest.json` 中声明 `favicon` 权限。
 * 2. **Firefox 及其他浏览器**：不支持内部 `_favicon` 节点。
 *    - 策略：回退至 `${origin}/favicon.ico` 这种最朴素的标准路径。
 * 3. **设计哲学**：
 *    - 隐私优先：默认不使用外部第三方图标解析服务（如 Google Favicon Service），避免用户访问记录泄露。
 *    - 简单性：减少 CSP（内容安全策略）的配置复杂度。
 */

/**
 * 检测当前环境是否为 Firefox
 * @returns {boolean} 如果是 Firefox 浏览器则返回 true
 * @description 通过 UserAgent 中的 Firefox 标记进行判定。
 */
export const isFirefox = (): boolean => {
  // Firefox 扩展页面的 UserAgent 包含稳定的 Firefox 标记，足以满足此场景的判定
  return typeof navigator !== "undefined" && /\bFirefox\//.test(navigator.userAgent)
}

/**
 * 获取页面的图标 URL
 * @param {string} pageUrl 目标网页的完整 URL
 * @param {number} size 所需图标的尺寸（仅对 Chromium 有效，默认 64）
 * @returns {string | null} 图标的 URL 或 null（如果 URL 无效）
 */
export const getBrowserFaviconUrl = (pageUrl: string, size = 64): string | null => {
  if (!pageUrl) return null

  let parsed: URL
  try {
    // 兼容用户输入的无协议 URL（例如 "github.com"、"httpbin.org"）
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pageUrl)
    const normalized = hasScheme ? pageUrl : `https://${pageUrl}`
    parsed = new URL(normalized)
  } catch {
    return null
  }

  const protocol = parsed.protocol
  const isHttp = protocol === "http:" || protocol === "https:"
  // 仅支持 HTTP/HTTPS 协议
  if (!isHttp) return null

  // Chromium 路径：利用浏览器内置服务获取图标
  if (!isFirefox() && typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    // _favicon 是 Chromium 内置节点，直接返回拼接后的扩展路径
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`)
  }

  // Firefox / 兜底方案：尝试获取站点根目录下的 favicon.ico
  return `${parsed.origin}/favicon.ico`
}
