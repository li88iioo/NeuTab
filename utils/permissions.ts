import { logger } from "./logger"

/**
 * 检查 Chrome 扩展权限是否已授予
 * @param chromeApi - Chrome API 对象（可为 undefined 以支持非 Chrome 环境）
 * @param permission - 权限名称（如 'bookmarks', 'history', 'topSites'）
 * @returns Promise<boolean> - true 表示已授权或不需要权限检查
 * @example
 * const granted = await ensureChromePermission(chrome, 'bookmarks')
 * if (granted) {
 *   chrome.bookmarks.search(...)
 * }
 */
export const ensureChromePermission = (
  chromeApi: typeof chrome | undefined,
  permission: string
): Promise<boolean> => {
  if (!chromeApi?.permissions?.contains) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    chromeApi.permissions.contains({ permissions: [permission] }, (granted) => {
      if (chromeApi.runtime?.lastError) {
        logger.warn(`[permissions] Failed to check ${permission}:`, chromeApi.runtime.lastError.message)
        resolve(false)
        return
      }
      if (!granted) {
        logger.warn(`[permissions] ${permission} not granted`)
      }
      resolve(!!granted)
    })
  })
}
