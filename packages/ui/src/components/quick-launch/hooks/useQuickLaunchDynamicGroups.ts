import { useEffect, useState } from "react"
import type { QuickLaunchApp, QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { logger } from "@neutab/shared/utils/logger"
import { ensureChromePermission } from "@neutab/shared/utils/permissions"
import { RECENT_ID, TOP_SITES_ID } from "@neutab/shared/constants/quickLaunchStorage"

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

    const chromeApi = (globalThis as any).chrome as any | undefined

    const setTopSitesSafe = (group: QuickLaunchGroup | null) => {
      if (isActive) setTopSitesGroup(group)
    }

    const runHistoryFallback = async () => {
      if (!chromeApi?.history?.search) {
        setTopSitesSafe(null)
        return
      }

      const granted = await ensureChromePermission(chromeApi, "history")
      if (!isActive) return
      if (!granted) {
        setTopSitesSafe(null)
        return
      }

      chromeApi.history.search({ text: "", maxResults: 200 }, (items: any[]) => {
        if (!isActive) return
        if (chromeApi.runtime?.lastError) {
          logger.warn("[topSites:fallback:history] Failed:", chromeApi.runtime.lastError.message)
          setTopSitesSafe(null)
          return
        }

        const apps: QuickLaunchApp[] = items
          .filter((i: any) => {
            if (!i.url) return false
            try {
              const u = new URL(i.url)
              return u.protocol === "http:" || u.protocol === "https:"
            } catch {
              return false
            }
          })
          .sort((a: any, b: any) => {
            const av = (a as any).visitCount ?? 0
            const bv = (b as any).visitCount ?? 0
            if (bv !== av) return bv - av
            const at = a.lastVisitTime ?? 0
            const bt = b.lastVisitTime ?? 0
            return bt - at
          })
          .slice(0, 14)
          .map((item: any) => ({
            id: `top_${item.url}`,
            name: item.title || labels.newTab,
            url: item.url!,
            color: "#7f8c8d",
            iconStyle: "image"
          }))

        setTopSitesSafe({ id: TOP_SITES_ID, name: labels.frequentlyVisited, apps })
      })
    }

    const loadTopSites = async () => {
      if (chromeApi?.topSites?.get) {
        const granted = await ensureChromePermission(chromeApi, "topSites")
        if (!isActive) return
        if (!granted) {
          void runHistoryFallback()
          return
        }

        chromeApi.topSites.get((sites: any[]) => {
          if (!isActive) return
          if (chromeApi.runtime?.lastError) {
            logger.warn("[topSites] Failed:", chromeApi.runtime.lastError.message)
            setTopSitesSafe(null)
            return
          }

          const apps: QuickLaunchApp[] = sites.slice(0, 14).map((site: any) => ({
            id: `top_${site.url}`,
            name: site.title,
            url: site.url,
            color: "#7f8c8d",
            iconStyle: "image"
          }))
          setTopSitesSafe({ id: TOP_SITES_ID, name: labels.frequentlyVisited, apps })
        })
        return
      }

      if (chromeApi) {
        void runHistoryFallback()
      } else {
        setTopSitesSafe(null)
      }
    }

    void loadTopSites()

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

    const chromeApi = (globalThis as any).chrome as any | undefined

    const setRecentSafe = (group: QuickLaunchGroup | null) => {
      if (isActive) setRecentGroup(group)
    }

    const loadRecent = async () => {
      if (!chromeApi?.history?.search) {
        setRecentSafe(null)
        return
      }

      const granted = await ensureChromePermission(chromeApi, "history")
      if (!isActive) return
      if (!granted) {
        setRecentSafe(null)
        return
      }

      chromeApi.history.search({ text: "", maxResults: 14 }, (items: any[]) => {
        if (!isActive) return
        if (chromeApi.runtime?.lastError) {
          logger.warn("[history] Failed:", chromeApi.runtime.lastError.message)
          setRecentSafe(null)
          return
        }

        const apps: QuickLaunchApp[] = items.filter((i: any) => i.url).map((item: any) => ({
          id: `hist_${item.id}`,
          name: item.title || labels.newTab,
          url: item.url!,
          color: "#95a5a6",
          iconStyle: "image"
        }))
        setRecentSafe({ id: RECENT_ID, name: labels.recentlyVisited, apps })
      })
    }

    void loadRecent()

    return () => {
      isActive = false
    }
  }, [showRecentHistory, labels.recentlyVisited, labels.newTab])

  return { topSitesGroup, recentGroup }
}
