import { useEffect, useRef } from "react"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"

type GroupsSetter = (value: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[] | undefined) => QuickLaunchGroup[])) => void | Promise<void>

const isLegacyFavicon = (source?: string): boolean => {
  if (!source) return false
  return source.includes("gstatic.com") || (
    (source.startsWith("chrome-extension://") || source.startsWith("moz-extension://")) &&
    source.includes("/_favicon/")
  )
}

// 两类旧地址一次迁移，重复执行时保留原引用，避免相互覆盖或重复写入。
const migrateFavicons = (groups: QuickLaunchGroup[]): QuickLaunchGroup[] => {
  let changed = false
  const migrated = groups.map((group) => {
    if (!group.apps.some((app) => isLegacyFavicon(app.customIcon))) return group
    changed = true
    return {
      ...group,
      apps: group.apps.map((app) => isLegacyFavicon(app.customIcon)
        ? { ...app, customIcon: undefined }
        : app)
    }
  })
  return changed ? migrated : groups
}

export const useQuickLaunchFaviconMigrations = (
  safeStorageGroups: QuickLaunchGroup[],
  setGroups: GroupsSetter
) => {
  const migratedRef = useRef(false)

  useEffect(() => {
    // 等待分组数据到达，再执行本次挂载的唯一一次迁移。
    // 后续由用户显式设置的图标地址保持原样。
    if (migratedRef.current || safeStorageGroups.length === 0) return
    migratedRef.current = true
    if (!safeStorageGroups.some((group) => group.apps.some((app) => isLegacyFavicon(app.customIcon)))) return
    // 使用最新存储值，避免异步加载或并行编辑期间写回旧的分组快照。
    void setGroups((current) => migrateFavicons(current ?? safeStorageGroups))
  }, [safeStorageGroups, setGroups])
}
