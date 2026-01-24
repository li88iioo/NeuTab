import { useEffect, useState } from "react"
import type { QuickLaunchApp, QuickLaunchGroup } from "~types/quickLaunch"
import { logger } from "~utils/logger"
import { RECENT_ID, TOP_SITES_ID } from "../quickLaunchStorage"

interface DynamicGroupLabels {
  frequentlyVisited: string
  recentlyVisited: string
  newTab: string
}

export const useQuickLaunchDynamicGroups = (
  showTopSites: boolean,
  showRecentHistory: boolean,
  labels: DynamicGroupLabels
) => {
  const [topSitesGroup, setTopSitesGroup] = useState<QuickLaunchGroup | null>(null)
  const [recentGroup, setRecentGroup] = useState<QuickLaunchGroup | null>(null)

  useEffect(() => {
    let isActive = true
    if (!showTopSites) {
      setTopSitesGroup(null)
      return
    }

    const chromeApi = typeof chrome === "undefined" ? undefined : chrome

    const setTopSitesSafe = (group: QuickLaunchGroup | null) => {
      if (isActive) setTopSitesGroup(group)
    }

    const checkPermission = (
      permission: string,
      onGranted: () => void,
      onDenied: () => void
    ) => {
      if (!chromeApi?.permissions?.contains) {
        onGranted()
        return
      }

      chromeApi.permissions.contains({ permissions: [permission] }, (granted) => {
        if (!isActive) return
        if (chromeApi.runtime?.lastError) {
          logger.warn(`[permissions] Failed to check ${permission}:`, chromeApi.runtime.lastError.message)
          onDenied()
          return
        }
        if (!granted) {
          logger.warn(`[permissions] ${permission} not granted`)
          onDenied()
          return
        }
        onGranted()
      })
    }

    const runHistoryFallback = () => {
      if (!chromeApi?.history?.search) {
        setTopSitesSafe(null)
        return
      }

      checkPermission(
        "history",
        () => {
          chromeApi.history.search({ text: "", maxResults: 200 }, (items) => {
            if (!isActive) return
            if (chromeApi.runtime?.lastError) {
              logger.warn("[topSites:fallback:history] Failed:", chromeApi.runtime.lastError.message)
              setTopSitesSafe(null)
              return
            }

            const apps: QuickLaunchApp[] = items
              .filter((i) => {
                if (!i.url) return false
                try {
                  const u = new URL(i.url)
                  return u.protocol === "http:" || u.protocol === "https:"
                } catch {
                  return false
                }
              })
              .sort((a, b) => {
                const av = (a as chrome.history.HistoryItem).visitCount ?? 0
                const bv = (b as chrome.history.HistoryItem).visitCount ?? 0
                if (bv !== av) return bv - av
                const at = a.lastVisitTime ?? 0
                const bt = b.lastVisitTime ?? 0
                return bt - at
              })
              .slice(0, 8)
              .map((item) => ({
                id: `top_${item.url}`,
                name: item.title || labels.newTab,
                url: item.url!,
                color: "#7f8c8d",
                iconStyle: "image"
              }))

            setTopSitesSafe({ id: TOP_SITES_ID, name: labels.frequentlyVisited, apps })
          })
        },
        () => setTopSitesSafe(null)
      )
    }

    if (chromeApi?.topSites?.get) {
      checkPermission(
        "topSites",
        () => {
          chromeApi.topSites.get((sites) => {
            if (!isActive) return
            if (chromeApi.runtime?.lastError) {
              logger.warn("[topSites] Failed:", chromeApi.runtime.lastError.message)
              setTopSitesSafe(null)
              return
            }

            const apps: QuickLaunchApp[] = sites.slice(0, 8).map((site) => ({
              id: `top_${site.url}`,
              name: site.title,
              url: site.url,
              color: "#7f8c8d",
              iconStyle: "image"
            }))
            setTopSitesSafe({ id: TOP_SITES_ID, name: labels.frequentlyVisited, apps })
          })
        },
        () => runHistoryFallback()
      )
    } else if (chromeApi) {
      runHistoryFallback()
    } else {
      setTopSitesSafe(null)
    }

    return () => {
      isActive = false
    }
  }, [showTopSites, labels.frequentlyVisited, labels.newTab])

  useEffect(() => {
    let isActive = true
    if (!showRecentHistory) {
      setRecentGroup(null)
      return
    }

    const chromeApi = typeof chrome === "undefined" ? undefined : chrome

    const setRecentSafe = (group: QuickLaunchGroup | null) => {
      if (isActive) setRecentGroup(group)
    }

    const checkPermission = (permission: string, onGranted: () => void, onDenied: () => void) => {
      if (!chromeApi?.permissions?.contains) {
        onGranted()
        return
      }
      chromeApi.permissions.contains({ permissions: [permission] }, (granted) => {
        if (!isActive) return
        if (chromeApi.runtime?.lastError) {
          logger.warn(`[permissions] Failed to check ${permission}:`, chromeApi.runtime.lastError.message)
          onDenied()
          return
        }
        if (!granted) {
          logger.warn(`[permissions] ${permission} not granted`)
          onDenied()
          return
        }
        onGranted()
      })
    }

    if (chromeApi?.history?.search) {
      checkPermission(
        "history",
        () => {
          chromeApi.history.search({ text: "", maxResults: 8 }, (items) => {
            if (!isActive) return
            if (chromeApi.runtime?.lastError) {
              logger.warn("[history] Failed:", chromeApi.runtime.lastError.message)
              setRecentSafe(null)
              return
            }

            const apps: QuickLaunchApp[] = items.filter(i => i.url).map((item) => ({
              id: `hist_${item.id}`,
              name: item.title || labels.newTab,
              url: item.url!,
              color: "#95a5a6",
              iconStyle: "image"
            }))
            setRecentSafe({ id: RECENT_ID, name: labels.recentlyVisited, apps })
          })
        },
        () => setRecentSafe(null)
      )
    } else {
      setRecentSafe(null)
    }

    return () => {
      isActive = false
    }
  }, [showRecentHistory, labels.recentlyVisited, labels.newTab])

  return { topSitesGroup, recentGroup }
}
