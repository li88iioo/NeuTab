import { useEffect, useLayoutEffect, useRef } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import type { QuickLaunchApp, QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import { getTranslations, type Language } from "@neutab/shared/utils/i18n"
import { setChunkedData, getChunkedData } from "~utils/chunkedStorage"
import { putGroups, getGroups } from "~utils/indexedDB"
import { logger } from "@neutab/shared/utils/logger"
import { GROUPS_KEY, localExtStorage, syncStorage } from "../quickLaunchStorage"

const hashString = (value: string): string => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}

const hashGroups = (groups: QuickLaunchGroup[]): string => {
  return hashString(JSON.stringify(groups))
}

const LOCAL_GROUPS_TIMESTAMP_KEY = `${GROUPS_KEY}_local_timestamp`
const LAST_MIGRATE_SYNC_KEY = "neutab_last_migrate_sync"
const MIGRATE_SYNC_THROTTLE_MS = 3000 // 3秒内不重复执行，防止快速刷新触发配额限制

export const useQuickLaunchGroups = (language: Language | undefined) => {
  const [groups, setGroups, { isLoading: isGroupsLoading }] = useStorage<QuickLaunchGroup[]>(
    { key: GROUPS_KEY, instance: localExtStorage },
    []
  )

  const lastSyncedHashRef = useRef<string | null>(null)
  const lastQueuedHashRef = useRef<string | null>(null)
  const lastLocalHashRef = useRef<string | null>(null)

  useEffect(() => {
    const migrateAndSync = async () => {
      // 防止快速刷新时频繁写入，超出 Plasmo Storage 配额限制
      const lastMigrateSync = parseInt(localStorage.getItem(LAST_MIGRATE_SYNC_KEY) || "0", 10)
      const now = Date.now()
      if (now - lastMigrateSync < MIGRATE_SYNC_THROTTLE_MS) {
        logger.debug("Skipping migrateAndSync - throttled")
        return
      }
      localStorage.setItem(LAST_MIGRATE_SYNC_KEY, String(now))

      try {
        const currentT = getTranslations(language || "zh")

        const [idbData, localData, localTimestamp, chunkedData, syncData, legacyApps] = await Promise.all([
          getGroups<QuickLaunchGroup[]>().catch(err => {
            logger.warn("Failed to read from IndexedDB:", err)
            return null
          }),
          localExtStorage.get<QuickLaunchGroup[]>(GROUPS_KEY),
          localExtStorage.get<number>(LOCAL_GROUPS_TIMESTAMP_KEY).catch(() => 0),
          getChunkedData<QuickLaunchGroup[]>(syncStorage, GROUPS_KEY),
          syncStorage.get<QuickLaunchGroup[]>(GROUPS_KEY),
          syncStorage.get<QuickLaunchApp[]>("quickLaunchApps")
        ])

        const cloudTimestamp = await syncStorage.get<number>(`${GROUPS_KEY}_timestamp`).catch(() => 0)

        let latestData: QuickLaunchGroup[] | null = null
        let latestTimestamp = 0
        let latestSource = "none"

        if (idbData?.data && Array.isArray(idbData.data) && idbData.data.length > 0) {
          const ts = idbData.timestamp || 0
          if (ts > latestTimestamp) {
            latestData = idbData.data
            latestTimestamp = ts
            latestSource = "IndexedDB"
          }
        }

        if (Array.isArray(chunkedData) && chunkedData.length > 0) {
          const ts = cloudTimestamp || 0
          if (ts > latestTimestamp) {
            latestData = chunkedData
            latestTimestamp = ts
            latestSource = "cloud-chunked"
          }
        }

        if (Array.isArray(syncData) && syncData.length > 0 && !chunkedData) {
          const ts = cloudTimestamp || 0
          if (ts > latestTimestamp) {
            latestData = syncData
            latestTimestamp = ts
            latestSource = "cloud-legacy"
          }
        }

        if (Array.isArray(localData) && localData.length > 0) {
          const ts = typeof localTimestamp === "number" ? localTimestamp : 0
          if (ts > latestTimestamp) {
            latestData = localData
            latestTimestamp = ts
            latestSource = "local"
          }
        }

        if (Array.isArray(legacyApps) && legacyApps.length > 0 && !latestData) {
          logger.debug("Migrating legacy quickLaunchApps to groups")
          latestData = [{ id: "default", name: currentT.default, apps: legacyApps }]
          latestTimestamp = 0
          latestSource = "legacy"
        }

        if (!latestData) {
          logger.debug("New installation, using default groups")
          latestData = DEFAULT_GROUPS
          latestTimestamp = Date.now()
          latestSource = "default"
        }

        logger.debug(`Restoring from ${latestSource} (timestamp: ${latestTimestamp})`)

        await Promise.all([
          localExtStorage.set(GROUPS_KEY, latestData),
          localExtStorage.set(LOCAL_GROUPS_TIMESTAMP_KEY, latestTimestamp)
        ])
        lastLocalHashRef.current = hashGroups(latestData)
        setGroups(latestData)

        Promise.all([
          putGroups(latestData).catch(err => logger.warn("Failed to backup to IndexedDB:", err)),
          setChunkedData(syncStorage, GROUPS_KEY, latestData).catch(err => logger.warn("Failed to sync to cloud:", err)),
          syncStorage.set(`${GROUPS_KEY}_timestamp`, latestTimestamp).catch(err => logger.warn("Failed to save timestamp:", err))
        ])
      } catch (error) {
        logger.error("Critical error in migrateAndSync:", error)
        setGroups(DEFAULT_GROUPS)
      }
    }

    if (!isGroupsLoading) {
      migrateAndSync()
    }
  }, [isGroupsLoading, setGroups, language])

  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleSyncRef = useRef<number | null>(null)
  const syncRevisionRef = useRef(0)
  useLayoutEffect(() => {
    if (isGroupsLoading || !groups || groups.length === 0) return

    const currentHash = hashGroups(groups)
    if (currentHash === lastLocalHashRef.current) return
    lastLocalHashRef.current = currentHash

    const timestamp = Date.now()
    void Promise.all([
      localExtStorage.set(GROUPS_KEY, groups),
      localExtStorage.set(LOCAL_GROUPS_TIMESTAMP_KEY, timestamp)
    ])
  }, [groups, isGroupsLoading])

  useEffect(() => {
    if (isGroupsLoading || !groups || groups.length === 0) return

    const currentHash = hashGroups(groups)
    if (currentHash === lastQueuedHashRef.current) return

    if (currentHash === lastSyncedHashRef.current) {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      if (idleSyncRef.current && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleSyncRef.current)
        idleSyncRef.current = null
      }
      return
    }

    syncRevisionRef.current += 1
    const revision = syncRevisionRef.current

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }
    if (idleSyncRef.current && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleSyncRef.current)
      idleSyncRef.current = null
    }

    lastQueuedHashRef.current = currentHash

    syncTimeoutRef.current = setTimeout(async () => {
      const runSync = async () => {
        if (revision !== syncRevisionRef.current) return

        const timestamp = Date.now()

        try {
          try {
            await putGroups(groups)
          } catch (error) {
            logger.warn("Failed to sync to IndexedDB:", error)
          }

          await Promise.all([
            setChunkedData(syncStorage, GROUPS_KEY, groups),
            syncStorage.set(`${GROUPS_KEY}_timestamp`, timestamp)
          ])

          lastSyncedHashRef.current = currentHash
          logger.debug(`Groups synced (timestamp: ${timestamp})`)
        } catch (error) {
          logger.warn("Failed to sync to cloud:", error)
        }
      }

      if ("scheduler" in window && typeof (window as Window & { scheduler?: { postTask: (fn: () => void, opts: any) => void } }).scheduler?.postTask === "function") {
        ;(window as any).scheduler.postTask(runSync, { priority: "background" })
        return
      }

      if (typeof window.requestIdleCallback === "function") {
        idleSyncRef.current = window.requestIdleCallback(
          () => {
            idleSyncRef.current = null
            void runSync()
          },
          { timeout: 2000 }
        )
        return
      }

      setTimeout(() => void runSync(), 0)
    }, 2000)

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      if (idleSyncRef.current && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleSyncRef.current)
        idleSyncRef.current = null
      }
    }
  }, [groups, isGroupsLoading])

  return { groups, setGroups, isGroupsLoading }
}
