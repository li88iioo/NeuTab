import { useEffect, useState } from "react"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { logger } from "@neutab/shared/utils/logger"
import { ensurePngBlobFromDataUrl } from "@neutab/shared/utils/rasterizeSvg"
import { blobToDataUrl } from "@neutab/shared/utils/importNormalization"

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('neutab_token')
  if (token) {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  }
  return { 'Content-Type': 'application/json' }
}

const saveLocalIcon = async (appId: string, base64: string) => {
  try {
    const token = localStorage.getItem('neutab_token')

    const converted = await ensurePngBlobFromDataUrl(base64, 256)
    if (!converted.mimeType.startsWith("image/")) throw new Error("Invalid icon type")

    try {
      const res = await fetch(`/api/icons/uploadRaw/${encodeURIComponent(appId)}`, {
        method: 'POST',
        headers: (() => {
          const h = new Headers()
          if (token) h.set('Authorization', `Bearer ${token}`)
          h.set('Content-Type', converted.mimeType)
          return h
        })(),
        body: converted.blob
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return
    } catch {
      const dataUrl = await blobToDataUrl(converted.blob)
      const res = await fetch('/api/icons/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ id: appId, data: dataUrl })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    }
  } catch (error) {
    logger.error("Failed to save icon to server:", error)
    throw error
  }
}

const getLocalIcon = async (appId: string): Promise<string | null> => {
  return `/api/icons/${appId}`
}

const removeLocalIcon = async (appId: string) => {
  try {
    await fetch(`/api/icons/${appId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
  } catch (error) {
    logger.warn("Failed to delete icon from server:", error)
  }
}

type GroupsSetter = (value: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[] | undefined) => QuickLaunchGroup[])) => void | Promise<void>

interface QuickLaunchIconsOptions {
  groups: QuickLaunchGroup[] | undefined
  isGroupsLoading: boolean
  setGroups: GroupsSetter
}

export const useQuickLaunchIcons = ({ groups, isGroupsLoading }: QuickLaunchIconsOptions) => {
  const [iconCache, setIconCache] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isGroupsLoading || !groups?.length) {
      return
    }

    // 对于标记了 hasLocalIcon 的 app，直接使用图标 URL
    const appsWithLocalIcon = groups
      .flatMap((g) => g.apps)
      .filter((app) => app.hasLocalIcon && (app.iconStyle ?? "image") === "image" && !iconCache[app.id])

    if (appsWithLocalIcon.length > 0) {
      const newCache: Record<string, string> = {}
      for (const app of appsWithLocalIcon) {
        newCache[app.id] = `/api/icons/${app.id}`
      }
      setIconCache(prev => ({ ...prev, ...newCache }))
    }
  }, [groups, isGroupsLoading])

  return {
    iconCache,
    setIconCache,
    saveLocalIcon,
    getLocalIcon,
    removeLocalIcon
  }
}
