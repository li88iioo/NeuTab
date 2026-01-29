/**
 * @file favicon.ts
 * @description 统一 Extension / Web 的 favicon 获取策略。
 *
 * - Extension (Chromium): 优先使用 MV3 `_favicon` 内部服务（快且准，需 `favicon` 权限）。
 * - Web (http/https): 使用服务端 `/api/favicon` 代理（避免客户端直连第三方，并可做缓存）。
 * - 其他环境: 回退到 `${origin}/favicon.ico`。
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

const isHttpOrigin = (): boolean => {
  try {
    const protocol = globalThis.location?.protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/**
 * 检测是否为内网/本地地址
 * @description 对这些地址请求 Google favicon 服务无意义
 */
const isPrivateOrLocalHost = (hostname: string): boolean => {
  // localhost
  if (hostname === 'localhost') return true

  // 本地域名后缀
  if (/\.(local|lan|home|internal|localdomain)$/i.test(hostname)) return true

  // IPv4 私有地址
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    // 10.x.x.x
    if (a === 10) return true
    // 172.16.x.x - 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.x.x
    if (a === 192 && b === 168) return true
    // 127.x.x.x (loopback)
    if (a === 127) return true
  }

  return false
}

/**
 * 获取页面的图标 URL
 * @param {string} pageUrl 目标网页的完整 URL
 * @param {number} size 所需图标的尺寸（默认 64）
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

  // Extension (Chromium): 利用浏览器内置服务获取图标
  const chromeApi = (globalThis as any).chrome
  if (!isFirefox() && chromeApi?.runtime?.getURL) {
    // _favicon 是 Chromium 内置节点，直接返回拼接后的扩展路径
    // 注意：必须传入“完整 URL”（含协议）。用户可能输入的是 "github.com" 这类无协议地址。
    return chromeApi.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(parsed.href)}&size=${size}`)
  }

  // Web: 通过服务端代理（可以落盘缓存，也避免客户端直连第三方）
  if (isHttpOrigin()) {
    const hostname = parsed.hostname
    // 跳过不完整域名（输入中间状态）
    if (!hostname.includes('.') && hostname !== 'localhost') {
      return null
    }
    // 跳过内网/本地地址（Google favicon 服务无法访问）
    if (isPrivateOrLocalHost(hostname)) {
      return null
    }
    return `/api/favicon?domain=${encodeURIComponent(hostname)}&sz=${encodeURIComponent(String(size))}`
  }

  // Firefox / 其他兜底：尝试获取站点根目录下的 favicon.ico
  return `${parsed.origin}/favicon.ico`
}
