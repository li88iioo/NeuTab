import { Storage } from "@plasmohq/storage"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import type { Language } from "@neutab/shared/utils/i18n"
import { setChunkedData } from "~utils/chunkedStorage"
import { putIcon } from "~utils/indexedDB"
import { ensurePngBlobFromDataUrl } from "@neutab/shared/utils/rasterizeSvg"
import { logger } from "@neutab/shared/utils/logger"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS, clampNumber, type ThemeMode, type VisualTheme } from "@neutab/shared/utils/settings"
import { blobToDataUrl, normalizeGroups } from "@neutab/shared/utils/importNormalization"
import { normalizeBackupImport } from "@neutab/shared/utils/backup"
import { GROUPS_KEY, localExtStorage, localImageExtStorage, syncStorage } from "~components/quick-launch/quickLaunchStorage"

export type CloudSyncPrefs = {
  syncEnabled: boolean
  autoSyncEnabled: boolean
  serverUrl: string
  authCode: string
}

export type CloudSyncStatus = {
  status: "success" | "failed"
  timestamp: string
  action: "pull" | "push"
}

const SETTINGS_STORAGE = new Storage()

const LAST_SYNC_TIME_KEY = "lastSyncTime"
const LAST_SYNC_STATUS_KEY = "lastSyncStatus"

export function readCloudSyncPrefs(): CloudSyncPrefs {
  const syncEnabled = window.localStorage.getItem("syncEnabled") === "true"
  const autoSyncEnabled = window.localStorage.getItem("autoSyncEnabled") === "true"
  const serverUrl = String(window.localStorage.getItem("syncServerUrl") || "").trim()
  const authCode = String(window.localStorage.getItem("syncAuthCode") || "").trim()
  return { syncEnabled, autoSyncEnabled, serverUrl, authCode }
}

export function writeCloudSyncStatus(next: CloudSyncStatus): void {
  try {
    window.localStorage.setItem(LAST_SYNC_TIME_KEY, next.timestamp)
    window.localStorage.setItem(LAST_SYNC_STATUS_KEY, next.status)
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent<CloudSyncStatus>("neutab-cloud-sync-status", { detail: next }))
  } catch {
    // ignore
  }
}

export function readCloudSyncStatus(): { lastSyncTime: string; lastSyncStatus: "success" | "failed" | "" } {
  const lastSyncTime = String(window.localStorage.getItem(LAST_SYNC_TIME_KEY) || "")
  const lastSyncStatus = String(window.localStorage.getItem(LAST_SYNC_STATUS_KEY) || "") as any
  return {
    lastSyncTime,
    lastSyncStatus: lastSyncStatus === "success" || lastSyncStatus === "failed" ? lastSyncStatus : ""
  }
}

const commitThemeCache = (nextMode: ThemeMode | undefined, nextVisual: VisualTheme | undefined) => {
  try {
    window.localStorage.setItem("theme_mode_cache", nextMode || "auto")
    window.localStorage.setItem("visual_theme_cache", nextVisual || "neumorphic")
  } catch {
    // ignore
  }
}

const commitLayoutCache = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}

export async function applyImportDataToStorage(raw: Record<string, any>, language: Language): Promise<void> {
  const { updates, groups, customIcons, meta } = normalizeBackupImport(raw, language)

  if (Object.keys(updates).length > 0) {
    await SETTINGS_STORAGE.setMany(updates)
  }

  if (groups) {
    await localExtStorage.set(GROUPS_KEY, groups)
    await setChunkedData(syncStorage, GROUPS_KEY, groups)
  }

  if (customIcons) {
    for (const [appId, base64] of Object.entries(customIcons)) {
      await localImageExtStorage.set(`icon_${appId}`, base64)
      try {
        await putIcon(appId, base64)
      } catch {
        // ignore
      }
    }
  }

  const nextThemeMode = (updates.themeMode as ThemeMode | undefined) ?? meta.themeMode ?? DEFAULT_SETTINGS.themeMode
  const nextVisualTheme = (updates.visualTheme as VisualTheme | undefined) ?? meta.visualTheme ?? DEFAULT_SETTINGS.visualTheme
  commitThemeCache(nextThemeMode, nextVisualTheme)

  if (typeof updates.contentMaxWidth === "number") commitLayoutCache("layout_contentMaxWidth", updates.contentMaxWidth)
  if (typeof updates.contentPaddingX === "number") commitLayoutCache("layout_contentPaddingX", updates.contentPaddingX)
  if (typeof updates.contentPaddingTop === "number") commitLayoutCache("layout_contentPaddingTop", updates.contentPaddingTop)
  if (typeof updates.contentPaddingBottom === "number") commitLayoutCache("layout_contentPaddingBottom", updates.contentPaddingBottom)
  if (typeof updates.iconBorderRadius === "number") commitLayoutCache("layout_iconBorderRadius", updates.iconBorderRadius)
  if (typeof updates.cardSize === "number") commitLayoutCache("layout_cardSize", updates.cardSize)

  try {
    if ("showClock" in updates) window.localStorage.setItem("viz_clock", String(Boolean(updates.showClock)))
    if ("showSearchBar" in updates) window.localStorage.setItem("viz_search", String(Boolean(updates.showSearchBar)))
    if ("showSeconds" in updates) window.localStorage.setItem("viz_seconds", String(Boolean(updates.showSeconds)))
    const lang = (updates.language as string | undefined) ?? (meta.language as string | undefined)
    if (lang === "zh" || lang === "en") window.localStorage.setItem("lang_cache", lang)
  } catch {
    // ignore
  }
}

export async function buildBackupPayload(language: Language): Promise<{
  version: 2
  exportedAt: string
  data: { settings: Record<string, unknown>; customIcons: Record<string, string> }
}> {
  const baseSettings = (await SETTINGS_STORAGE.getMany(Object.keys(DEFAULT_SETTINGS))) as Record<string, any>
  const searchEngines = await SETTINGS_STORAGE.get("searchEngines")
  const currentEngine = await SETTINGS_STORAGE.get("currentEngine")
  const openInNewWindow = await SETTINGS_STORAGE.get("searchOpenInNewWindow")

  const groupsRaw = await localExtStorage.get<QuickLaunchGroup[]>(GROUPS_KEY)
  const groups = normalizeGroups(groupsRaw, language) || (Array.isArray(groupsRaw) && groupsRaw.length ? groupsRaw : DEFAULT_GROUPS)

  const customIcons: Record<string, string> = {}
  for (const group of groups) {
    for (const app of group.apps) {
      const base64 = await localImageExtStorage.get(`icon_${app.id}`)
      if (typeof base64 === "string" && base64.startsWith("data:image/")) {
        customIcons[app.id] = base64
      }
    }
  }

  const settings: Record<string, unknown> = {
    ...baseSettings,
    searchEngines,
    currentEngine,
    searchOpenInNewWindow: typeof openInNewWindow === "boolean" ? openInNewWindow : baseSettings.searchOpenInNewWindow,
    quickLaunchGroups: groups,
    themeMode: (baseSettings.themeMode as ThemeMode | undefined) || DEFAULT_SETTINGS.themeMode,
    visualTheme: (baseSettings.visualTheme as VisualTheme | undefined) || DEFAULT_SETTINGS.visualTheme,
    language: (baseSettings.language as Language | undefined) || language || DEFAULT_SETTINGS.language,
    contentMaxWidth: clampNumber(
      Number(baseSettings.contentMaxWidth ?? DEFAULT_SETTINGS.contentMaxWidth),
      LAYOUT_LIMITS.maxWidth.min,
      LAYOUT_LIMITS.maxWidth.max
    ),
    contentPaddingX: clampNumber(
      Number(baseSettings.contentPaddingX ?? DEFAULT_SETTINGS.contentPaddingX),
      LAYOUT_LIMITS.paddingX.min,
      LAYOUT_LIMITS.paddingX.max
    ),
    contentPaddingTop: clampNumber(
      Number(baseSettings.contentPaddingTop ?? DEFAULT_SETTINGS.contentPaddingTop),
      LAYOUT_LIMITS.paddingTop.min,
      LAYOUT_LIMITS.paddingTop.max
    ),
    contentPaddingBottom: clampNumber(
      Number(baseSettings.contentPaddingBottom ?? DEFAULT_SETTINGS.contentPaddingBottom),
      LAYOUT_LIMITS.paddingBottom.min,
      LAYOUT_LIMITS.paddingBottom.max
    ),
    iconBorderRadius: clampNumber(
      Number(baseSettings.iconBorderRadius ?? DEFAULT_SETTINGS.iconBorderRadius),
      LAYOUT_LIMITS.iconBorderRadius.min,
      LAYOUT_LIMITS.iconBorderRadius.max
    ),
    cardSize: clampNumber(
      Number(baseSettings.cardSize ?? DEFAULT_SETTINGS.cardSize),
      LAYOUT_LIMITS.cardSize.min,
      LAYOUT_LIMITS.cardSize.max
    )
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    data: { settings, customIcons }
  }
}

export async function cloudPull(serverUrl: string, authCode: string, language: Language): Promise<void> {
  const baseUrl = serverUrl.replace(/\/$/, "")
  const res = await fetch(`${baseUrl}/api/sync/pull?v=3`, { headers: { "X-Auth-Code": authCode } })
  if (!res.ok) throw new Error(`Pull failed: HTTP ${res.status}`)

  const payload = await res.json()
  const data = payload?.data ?? payload
  await applyImportDataToStorage(data, language)

  const iconIds = Array.isArray(data?.iconIds) ? (data.iconIds as string[]) : []
  if (iconIds.length === 0) return

  let logged = 0
  const MAX_LOGS = 3

  const CONCURRENCY = 4
  for (let i = 0; i < iconIds.length; i += CONCURRENCY) {
    const batch = iconIds.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (iconId) => {
        try {
          const iconRes = await fetch(`${baseUrl}/api/icons/${encodeURIComponent(iconId)}`)
          if (!iconRes.ok) return
          const blob = await iconRes.blob()
          if (!blob.type.startsWith("image/")) return
          const base64 = await blobToDataUrl(blob)
          await localImageExtStorage.set(`icon_${iconId}`, base64)
          try {
            await putIcon(iconId, base64)
          } catch {
            // ignore
          }
        } catch (e) {
          if (logged < MAX_LOGS) {
            logged += 1
            logger.warn("[CloudSync] pull icon failed:", iconId, e)
          }
        }
      })
    )
  }
}

export async function cloudPush(
  serverUrl: string,
  authCode: string,
  language: Language,
  opts?: { uploadIcons?: boolean }
): Promise<void> {
  const baseUrl = serverUrl.replace(/\/$/, "")
  const backupPayload = await buildBackupPayload(language)
  const settings = (backupPayload?.data?.settings ?? {}) as Record<string, unknown>
  const customIcons = (backupPayload?.data?.customIcons ?? {}) as Record<string, unknown>

  const uploadIcons = opts?.uploadIcons !== false
  if (uploadIcons) {
    const iconEntries = Object.entries(customIcons)
      .filter(([, v]) => typeof v === "string" && (v as string).startsWith("data:image/")) as Array<[string, string]>

    const CONCURRENCY = 3
    for (let i = 0; i < iconEntries.length; i += CONCURRENCY) {
      const batch = iconEntries.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async ([appId, base64]) => {
          const converted = await ensurePngBlobFromDataUrl(base64, 256)
          if (!converted.mimeType.startsWith("image/")) throw new Error("Invalid icon type")

          try {
            const uploadRes = await fetch(`${baseUrl}/api/icons/uploadRaw/${encodeURIComponent(appId)}`, {
              method: "POST",
              headers: {
                "X-Auth-Code": authCode,
                "Content-Type": converted.mimeType
              },
              body: converted.blob
            })
            if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`)
          } catch {
            const dataUrl = await blobToDataUrl(converted.blob)
            const uploadRes = await fetch(`${baseUrl}/api/icons/upload`, {
              method: "POST",
              headers: {
                "X-Auth-Code": authCode,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ id: appId, data: dataUrl })
            })
            if (!uploadRes.ok) throw new Error(`Icon upload failed: ${appId}`)
          }
        })
      )
    }
  }

  const payload = {
    version: 3,
    exportedAt: backupPayload.exportedAt,
    data: { settings }
  }
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Code": authCode },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Push failed: HTTP ${res.status}`)
}
