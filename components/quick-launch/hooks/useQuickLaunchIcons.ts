import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import { putIcon, getIcon, deleteIcon } from "~utils/indexedDB"
import { logger } from "@neutab/shared/utils/logger"
import { localImageExtStorage } from "../quickLaunchStorage"

const saveLocalIcon = async (appId: string, base64: string) => {
  let idbSuccess = false

  try {
    await putIcon(appId, base64)
    idbSuccess = true
  } catch (error) {
    logger.error("Failed to save icon to IndexedDB:", error)
  }

  try {
    await localImageExtStorage.set(`icon_${appId}`, base64)
  } catch (error) {
    logger.error("Failed to save icon to chrome.storage:", error)
    if (!idbSuccess) {
      throw new Error("Failed to save icon to both IndexedDB and chrome.storage")
    }
  }
}

const getLocalIcon = async (appId: string): Promise<string | null> => {
  try {
    const idbIcon = await getIcon(appId)
    if (idbIcon) return idbIcon
  } catch (error) {
    logger.warn("Failed to read icon from IndexedDB:", error)
  }
  return await localImageExtStorage.get(`icon_${appId}`) || null
}

const removeLocalIcon = async (appId: string) => {
  await localImageExtStorage.remove(`icon_${appId}`)
  try {
    await deleteIcon(appId)
  } catch (error) {
    logger.warn("Failed to delete icon from IndexedDB:", error)
  }
}

type GroupsSetter = (value: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[] | undefined) => QuickLaunchGroup[])) => void | Promise<void>

interface QuickLaunchIconsOptions {
  groups: QuickLaunchGroup[] | undefined
  isGroupsLoading: boolean
  setGroups: GroupsSetter
}

export const useQuickLaunchIcons = ({ groups, isGroupsLoading, setGroups }: QuickLaunchIconsOptions) => {
  const [iconCache, setIconCache] = useState<Record<string, string>>({})
  const iconCacheRef = useRef<Record<string, string>>({})
  const missingIdsRef = useRef<Set<string>>(new Set())
  const [iconStorageRevision, setIconStorageRevision] = useState(0)

  const updateIconCache = useCallback((nextValue: SetStateAction<Record<string, string>>) => {
    setIconCache((prev) => {
      const next = typeof nextValue === "function"
        ? (nextValue as (prev: Record<string, string>) => Record<string, string>)(prev)
        : nextValue
      iconCacheRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return

      const changedIds: string[] = []
      for (const key of Object.keys(changes)) {
        if (!key.startsWith("icon_")) continue
        const id = key.slice("icon_".length)
        missingIdsRef.current.delete(id)
        changedIds.push(id)
      }

      if (changedIds.length > 0) {
        updateIconCache((prev) => {
          const next = { ...prev }
          for (const id of changedIds) delete next[id]
          return next
        })
        setIconStorageRevision((prev) => prev + 1)
      }
    }

    try {
      chrome.storage.onChanged.addListener(onChanged)
      return () => {
        chrome.storage.onChanged.removeListener(onChanged)
      }
    } catch {
      return undefined
    }
  }, [])

  useEffect(() => {
    if (isGroupsLoading || !groups?.length) {
      return
    }

    let active = true
    const loadIcons = async () => {
      const newCache: Record<string, string> = {}
      let hasUpdates = false
      const idsMissingFlag: string[] = []

      const allApps = groups
        .flatMap((g) => g.apps)
        .filter((app) => {
          if ((app.iconStyle ?? "image") !== "image") return false
          if (iconCacheRef.current[app.id]) return false
          if (app.hasLocalIcon === true) return true
          return !missingIdsRef.current.has(app.id)
        })

      const BATCH_SIZE = 5
      for (let i = 0; i < allApps.length; i += BATCH_SIZE) {
        if (!active) break

        const batch = allApps.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async (app) => {
          const localIcon = await getLocalIcon(app.id)
          if (localIcon) {
            newCache[app.id] = localIcon
            missingIdsRef.current.delete(app.id)
            hasUpdates = true
            if (app.hasLocalIcon !== true) {
              idsMissingFlag.push(app.id)
            }
          } else if (app.hasLocalIcon !== true) {
            missingIdsRef.current.add(app.id)
          }
        }))

        await new Promise(resolve => setTimeout(resolve, 10))
      }

      if (active && hasUpdates) {
        updateIconCache(prev => {
          const next = { ...prev, ...newCache }
          return next
        })
      }

      if (active && idsMissingFlag.length > 0) {
        const ids = new Set(idsMissingFlag)
        setGroups((prev) => {
          const current = prev?.length ? prev : DEFAULT_GROUPS
          let changed = false
          const next = current.map((g) => ({
            ...g,
            apps: g.apps.map((a) => {
              if (!ids.has(a.id)) return a
              if (a.hasLocalIcon === true) return a
              changed = true
              return { ...a, hasLocalIcon: true }
            })
          }))
          return changed ? next : current
        })
      }
    }

    loadIcons()
    return () => { active = false }
  }, [groups, iconStorageRevision, isGroupsLoading, updateIconCache])

  return {
    iconCache,
    setIconCache: updateIconCache,
    saveLocalIcon,
    getLocalIcon,
    removeLocalIcon
  }
}
