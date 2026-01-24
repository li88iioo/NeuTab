/**
 * 提取域名 (用于图标匹配)
 * @description 从给定的 URL 字符串中提取主机名，并移除 `www.` 前缀。
 * @param url 目标网站 URL
 * @returns 提取后的纯域名字符串，若格式错误则返回空串
 */
export const extractDomain = (url: string): string => {
  try {
    // 不能用 startsWith("http")：会误判 "httpbin.org" 这类域名为“已有协议”。
    // 这里用更精确的 scheme 检测（与 sanitizeUrl 一致）。
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
    const urlObj = new URL(hasScheme ? url : `https://${url}`)
    return urlObj.hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/**
 * 获取首字母占位符
 * @param name 站点或应用名称
 * @returns 大写的首字母
 */
export const getInitial = (name: string): string => {
  const trimmed = (name ?? "").trim()
  return (trimmed.charAt(0) || "?").toUpperCase()
}

/**
 * 获取稳定随机色 (用于字母头像)
 * @description 基于字符串哈希算法，确保同一个名称总是返回相同的预设颜色，保证视觉一致性。
 * @param name 站点或应用名称
 * @returns 一个十六进制颜色字符串
 */
export const getLetterColor = (name: string): string => {
  const colors = [
    "#6c5ce7", // Purple
    "#0984e3", // Blue
    "#00b894", // Green
    "#fdcb6e", // Yellow
    "#e17055", // Orange
    "#d63031", // Red
    "#a29bfe", // Light purple
    "#74b9ff" // Light blue
  ]

  // 简单的字符串哈希计算
  const hash = name.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)

  return colors[Math.abs(hash) % colors.length]
}
