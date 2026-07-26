import { useEffect, useRef } from "react"
import { sanitizeUrl } from "@neutab/shared/utils/validation"

/**
 * 站点元数据管理
 * @description 将用户自定义的标签页标题与 Favicon 同步到 document,
 * 并缓存标题供首屏恢复;清除自定义值时还原浏览器默认。
 */
export const useSiteMetadata = (siteTitle: string, siteFavicon: string) => {
  const defaultTitleRef = useRef<string | null>(null)
  const defaultFaviconRef = useRef<string | null>(null)

  /** 动态更新网页标题 */
  useEffect(() => {
    if (defaultTitleRef.current === null) {
      defaultTitleRef.current = document.title
    }
    const title = siteTitle.trim() || defaultTitleRef.current || ""
    if (title) document.title = title
    try {
      if (title) localStorage.setItem("site_title_cache", title)
    } catch {
      // ignore
    }
  }, [siteTitle])

  /** 动态更新 Favicon */
  useEffect(() => {
    if (defaultFaviconRef.current === null) {
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      defaultFaviconRef.current = existing?.href ?? null
    }
    const faviconValue = siteFavicon.trim()
    const safeFaviconValue = (() => {
      if (!faviconValue) return ""
      if (faviconValue.startsWith("data:image/")) return faviconValue
      try {
        return sanitizeUrl(faviconValue)
      } catch {
        return ""
      }
    })()
    const customLink = document.querySelector<HTMLLinkElement>('link#custom-favicon')

    if (safeFaviconValue) {
      const link = customLink || document.createElement("link")
      link.id = "custom-favicon"
      link.rel = "icon"
      link.href = safeFaviconValue
      document.head.appendChild(link)
    } else if (customLink) {
      customLink.remove()
      const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
      if (existing && defaultFaviconRef.current) {
        existing.href = defaultFaviconRef.current
      }
    }
  }, [siteFavicon])
}
