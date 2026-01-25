import { useEffect, useState } from "react"
import type { QuickLaunchGroup } from "~types/quickLaunch"

type GroupsSetter = (value: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[] | undefined) => QuickLaunchGroup[])) => void | Promise<void>

export const useQuickLaunchFaviconMigrations = (
  safeStorageGroups: QuickLaunchGroup[],
  setGroups: GroupsSetter
) => {
  const [faviconMigrated, setFaviconMigrated] = useState(false)
  useEffect(() => {
    if (faviconMigrated) return
    const needsMigration = safeStorageGroups.some((group) => group.apps.some((app) => app.customIcon?.includes("gstatic.com")))
    if (!needsMigration) {
      setFaviconMigrated(true)
      return
    }
    const migratedGroups = safeStorageGroups.map((group) => ({
      ...group,
      apps: group.apps.map((app) => {
        if (app.customIcon?.includes("gstatic.com")) {
          return {
            ...app,
            customIcon: undefined
          }
        }
        return app
      })
    }))
    setGroups(migratedGroups)
    setFaviconMigrated(true)
  }, [safeStorageGroups, setGroups, faviconMigrated])

  const [internalFaviconMigrated, setInternalFaviconMigrated] = useState(false)
  useEffect(() => {
    if (internalFaviconMigrated) return
    if (!safeStorageGroups.length) {
      setInternalFaviconMigrated(true)
      return
    }

    const isInternalFavicon = (s?: string) => {
      if (!s) return false
      return (
        (s.startsWith("chrome-extension://") || s.startsWith("moz-extension://")) &&
        s.includes("/_favicon/")
      )
    }

    const needs = safeStorageGroups.some((g) => g.apps.some((a) => isInternalFavicon(a.customIcon)))
    if (!needs) {
      setInternalFaviconMigrated(true)
      return
    }

    const migrated = safeStorageGroups.map((g) => ({
      ...g,
      apps: g.apps.map((a) => {
        if (!isInternalFavicon(a.customIcon)) return a
        return { ...a, customIcon: undefined }
      })
    }))

    setGroups(migrated)
    setInternalFaviconMigrated(true)
  }, [safeStorageGroups, setGroups, internalFaviconMigrated])
}
