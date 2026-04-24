import { useEffect, useRef } from "react"
import { logger } from "@neutab/shared/utils/logger"
import { cloudPull, cloudPush, readCloudSyncPrefs, writeCloudSyncStatus } from "~utils/cloudSync"
import { DEFAULT_SETTINGS } from "@neutab/shared/utils/settings"
import type { Language } from "@neutab/shared/utils/i18n"

const PUSH_DEBOUNCE_MS = 2500
const SUPPRESS_PUSH_AFTER_PULL_MS = 5000
const AUTO_PULL_COOLDOWN_MS = 60_000

const LAST_AUTO_PULL_AT_KEY = "cloudSync_lastAutoPullAt"

const readLanguage = (): Language => {
  try {
    const cached = localStorage.getItem("lang_cache")
    if (cached === "zh" || cached === "en") return cached
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS.language
}

const isRelevantSyncKey = (key: string): boolean => {
  if (!key) return false
  if (key.includes("_chunk_")) return false
  if (key === "quickLaunchGroups_timestamp") return false
  if (key === "quickLaunchApps") return false

  if (key in DEFAULT_SETTINGS) return true
  if (key === "searchEngines" || key === "currentEngine" || key === "searchOpenInNewWindow") return true
  return false
}

export default function CloudSyncAgent() {
  const syncingRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressPushUntilRef = useRef(0)
  const pendingPushRef = useRef(false)
  const uploadIconsNextPushRef = useRef(true)
  const lastPrefsKeyRef = useRef("")

  const schedulePush = (delayMs = PUSH_DEBOUNCE_MS) => {
    void (async () => {
      const prefs = await readCloudSyncPrefs()
      if (!prefs.syncEnabled || !prefs.autoSyncEnabled || !prefs.serverUrl || !prefs.authCode) return

      pendingPushRef.current = true
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      const suppressDelay = Math.max(0, suppressPushUntilRef.current - Date.now())
      pushTimerRef.current = setTimeout(() => {
        void runPush()
      }, Math.max(delayMs, suppressDelay))
    })()
  }

  const runPull = async () => {
    const prefs = await readCloudSyncPrefs()
    if (!prefs.syncEnabled || !prefs.autoSyncEnabled || !prefs.serverUrl || !prefs.authCode) return
    if (syncingRef.current) return

    try {
      const last = Number(window.localStorage.getItem(LAST_AUTO_PULL_AT_KEY) || "0")
      if (Number.isFinite(last) && last > 0 && Date.now() - last < AUTO_PULL_COOLDOWN_MS) {
        return
      }
      window.localStorage.setItem(LAST_AUTO_PULL_AT_KEY, String(Date.now()))
    } catch {
      // ignore
    }

    syncingRef.current = true
    try {
      const language = readLanguage()
      await cloudPull(prefs.serverUrl, prefs.authCode, language)
      suppressPushUntilRef.current = Date.now() + SUPPRESS_PUSH_AFTER_PULL_MS
      // After a pull, we don't know if the server already has all local icons; upload once on next push.
      uploadIconsNextPushRef.current = true
      const timestamp = new Date().toISOString()
      writeCloudSyncStatus({ action: "pull", status: "success", timestamp })
    } catch (e) {
      logger.warn("[CloudSync] auto pull failed:", e)
      const timestamp = new Date().toISOString()
      writeCloudSyncStatus({ action: "pull", status: "failed", timestamp })
    } finally {
      syncingRef.current = false
    }
  }

  const runPush = async () => {
    const prefs = await readCloudSyncPrefs()
    if (!prefs.syncEnabled || !prefs.autoSyncEnabled || !prefs.serverUrl || !prefs.authCode) return
    if (syncingRef.current) {
      schedulePush()
      return
    }
    const suppressDelay = suppressPushUntilRef.current - Date.now()
    if (suppressDelay > 0) {
      schedulePush(suppressDelay)
      return
    }

    if (!pendingPushRef.current) return
    pendingPushRef.current = false

    syncingRef.current = true
    try {
      const language = readLanguage()
      const uploadIcons = uploadIconsNextPushRef.current
      uploadIconsNextPushRef.current = false
      await cloudPush(prefs.serverUrl, prefs.authCode, language, { uploadIcons })
      const timestamp = new Date().toISOString()
      writeCloudSyncStatus({ action: "push", status: "success", timestamp })
    } catch (e) {
      logger.warn("[CloudSync] auto push failed:", e)
      const timestamp = new Date().toISOString()
      writeCloudSyncStatus({ action: "push", status: "failed", timestamp })
    } finally {
      syncingRef.current = false
      if (pendingPushRef.current) schedulePush()
    }
  }

  useEffect(() => {
    // Trigger auto pull when prefs turn on (polling, because prefs live in localStorage).
    const poll = () => {
      void (async () => {
        const prefs = await readCloudSyncPrefs()
        const key = `${prefs.syncEnabled}|${prefs.autoSyncEnabled}|${prefs.serverUrl}|${prefs.authCode}`
        if (key !== lastPrefsKeyRef.current) {
          lastPrefsKeyRef.current = key
          if (prefs.syncEnabled && prefs.autoSyncEnabled && prefs.serverUrl && prefs.authCode) {
            uploadIconsNextPushRef.current = true
            void runPull()
          }
        }
      })()
    }

    poll()
    const interval = setInterval(poll, 2000)

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      void (async () => {
        const prefs = await readCloudSyncPrefs()
        if (!prefs.syncEnabled || !prefs.autoSyncEnabled) return

        if (areaName === "local") {
          for (const key of Object.keys(changes)) {
            if (key.startsWith("icon_")) {
              uploadIconsNextPushRef.current = true
              schedulePush()
              return
            }
            if (key === "quickLaunchGroups") {
              schedulePush()
              return
            }
          }
          return
        }

        if (areaName === "sync") {
          for (const key of Object.keys(changes)) {
            if (isRelevantSyncKey(key)) {
              schedulePush()
              return
            }
          }
        }
      })()
    }

    try {
      chrome.storage.onChanged.addListener(onChanged)
    } catch {
      // ignore
    }

    return () => {
      clearInterval(interval)
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      try {
        chrome.storage.onChanged.removeListener(onChanged)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
