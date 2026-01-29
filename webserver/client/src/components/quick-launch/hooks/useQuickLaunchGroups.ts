import { useEffect, useRef, useState, useCallback } from "react"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import type { Language } from "@neutab/shared/utils/i18n"
import { logger } from "@neutab/shared/utils/logger"
import { Storage } from "~shims/storage"
import { GROUPS_KEY } from "@neutab/shared/constants/quickLaunchStorage"

const storage = new Storage()

/**
 * Web 版本 QuickLaunch Groups 存储
 * 数据存服务器，localStorage 做缓存
 */
export const useQuickLaunchGroups = (_language: Language | undefined) => {
  const [groups, setGroupsState] = useState<QuickLaunchGroup[]>(() => {
    try {
      const stored = localStorage.getItem(GROUPS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_GROUPS
  })
  const [isGroupsLoading] = useState(false)
  const selfUpdateRef = useRef(false)

  // 包装 setGroups，同时写缓存和服务器
  const setGroups = useCallback((newGroups: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[]) => QuickLaunchGroup[])) => {
    setGroupsState(prev => {
      const resolved = typeof newGroups === 'function' ? newGroups(prev) : newGroups

      selfUpdateRef.current = true

      // 写入 localStorage 缓存
      localStorage.setItem(GROUPS_KEY, JSON.stringify(resolved))

      // 延迟触发事件和写入服务器，避免渲染期间状态更新
      queueMicrotask(() => {
        // 触发本地事件
        window.dispatchEvent(new CustomEvent('neutab-storage-update', {
          detail: { key: GROUPS_KEY, newValue: resolved }
        }))

        // 异步写入服务器
        storage.set(GROUPS_KEY, resolved).catch(e => {
          logger.error("Failed to save groups to server:", e)
        })

        selfUpdateRef.current = false
        logger.debug(`Saved ${resolved.length} groups`)
      })

      return resolved
    })
  }, [])

  // 监听变化
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === GROUPS_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (Array.isArray(parsed)) {
            setGroupsState(parsed)
          }
        } catch { /* ignore */ }
      }
    }

    const handleCustomStorageChange = (e: Event) => {
      if (selfUpdateRef.current) return
      const detail = (e as CustomEvent<{ key: string; newValue: unknown }>).detail
      if (detail.key === GROUPS_KEY && Array.isArray(detail.newValue)) {
        setGroupsState(detail.newValue as QuickLaunchGroup[])
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('neutab-storage-update', handleCustomStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('neutab-storage-update', handleCustomStorageChange)
    }
  }, [])

  return { groups, setGroups, isGroupsLoading }
}
