/**
 * Chrome 扩展 API 的最小结构类型
 * @description shared/ui 包同时被扩展与网页版复用,网页版编译环境没有 @types/chrome,
 * 不能写 `typeof chrome`。这里只声明代码实际用到的 API 面。
 */

export interface ChromeHistoryItem {
  id: string
  url?: string
  title?: string
  lastVisitTime?: number
  visitCount?: number
}

export interface ChromeTopSite {
  url: string
  title: string
}

export interface ChromeBookmarkNode {
  id: string
  title: string
  url?: string
  children?: ChromeBookmarkNode[]
}

export interface ChromeLike {
  runtime?: {
    lastError?: { message?: string }
    getURL?: (path: string) => string
  }
  permissions?: {
    contains: (perms: { permissions: string[] }, cb: (granted: boolean) => void) => void
  }
  history?: {
    search: (query: { text: string; maxResults: number }, cb: (items: ChromeHistoryItem[]) => void) => void
  }
  topSites?: {
    get: (cb: (sites: ChromeTopSite[]) => void) => void
  }
  bookmarks?: {
    search: (query: string, cb: (results: ChromeBookmarkNode[]) => void) => void
  }
  storage?: {
    sync?: { QUOTA_BYTES_PER_ITEM?: number }
  }
}

/** 从 globalThis 取 chrome API(网页环境返回 undefined) */
export const getChromeApi = (): ChromeLike | undefined => {
  return (globalThis as { chrome?: ChromeLike }).chrome
}
