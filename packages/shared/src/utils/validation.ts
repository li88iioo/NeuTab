/**
 * 链接清洗与验证
 * @description
 * 1. 自动为缺少协议的 URL 补全 `https://`(向后兼容旧版本行为)。
 * 2. 限制仅能使用 `http` 或 `https` 协议(防止 `javascript:` 或 `data:` 注入)。
 * 3. 验证 URL 格式是否合法。
 *
 * 向后兼容性保证:
 * - "github.com" → "https://github.com/"
 * - "httpbin.org" → "https://httpbin.org/" (正确处理以http开头的域名)
 * - "example.com/path" → "https://example.com/path"
 * - "sub.domain.com:8080" → "https://sub.domain.com:8080/"
 * - "https://example.com" → "https://example.com/" (保持不变)
 * - "http://example.com" → "http://example.com/" (保持不变)
 *
 * @param url 原始 URL 字符串
 * @returns 规范化后的完整 URL
 * @throws 格式错误或非法协议时抛出 Error
 */
export const sanitizeUrl = (url: string): string => {
  const trimmed = url.trim()
  if (!trimmed) throw new Error("URL cannot be empty")

  try {
    // 检测是否已有scheme(协议头)
    // 使用正则而非startsWith("http")避免误伤httpbin.org等域名
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP/HTTPS protocols are allowed")
    }
    return parsed.toString()
  } catch (e) {
    // 保留原始错误信息以便调试
    if (e instanceof Error && e.message === "Only HTTP/HTTPS protocols are allowed") {
      throw e
    }
    throw new Error("Invalid URL format")
  }
}

/** @returns true if url parses and uses http/https. */
export const isHttpUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Internal browser pages (for QuickLaunch "internalUrl").
 * Keep this narrow to avoid accidentally allowing executable schemes (e.g. javascript:, data:).
 */
export const isInternalUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === "chrome:" || u.protocol === "edge:" || u.protocol === "about:"
  } catch {
    return false
  }
}

/**
 * Normalize and validate internal browser URLs.
 * Allowed schemes: chrome://, edge://, about:
 * Also allows http/https for intranet URLs.
 */
export const sanitizeInternalUrl = (url: string): string => {
  const trimmed = url.trim()
  if (!trimmed) throw new Error("URL cannot be empty")

  try {
    // 检测是否已有scheme(协议头)
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)

    // Allow "internal network" URLs as well (http/https), since this field is often
    // used as an intranet alternative endpoint.
    if (!hasScheme) {
      // 无协议头,当作http(s) URL处理
      return sanitizeUrl(trimmed)
    }

    const parsed = new URL(trimmed)
    const protocol = parsed.protocol

    // 允许http/https(内网地址)
    if (protocol === "http:" || protocol === "https:") {
      return parsed.toString()
    }

    // 允许浏览器内部协议
    if (protocol === "chrome:" || protocol === "edge:" || protocol === "about:") {
      return parsed.toString()
    }

    throw new Error("Only supported URL protocols are allowed")
  } catch (e) {
    if (e instanceof Error && e.message === "Only supported URL protocols are allowed") {
      throw e
    }
    if (e instanceof Error && e.message === "Only HTTP/HTTPS protocols are allowed") {
      throw e
    }
    throw new Error("Invalid URL format")
  }
}

/**
 * Navigation allow-list used at click time.
 * External: http/https
 * Internal: chrome/edge/about (as configured above)
 */
export const isAllowedNavigationUrl = (url: string): boolean => {
  return isHttpUrl(url) || isInternalUrl(url)
}

/**
 * 名称清洗
 * @description
 * 1. 移除 `<` 和 `>` 符号防止简单的 HTML 注入。
 * 2. 截断最大长度为 50 字符，防止 UI 溢出。
 * 注意：不移除首尾空格，允许用户保存空白分组名。
 *
 * @param name 原始名称
 */
export const sanitizeName = (name: string): string => {
  return name.replace(/[<>]/g, '').slice(0, 50)
}

/** Best-effort color sanitizer (falls back to a safe default). */
export const sanitizeHexColor = (color: string, fallback = "#6c5ce7"): string => {
  const c = String(color ?? "").trim()
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : fallback
}
