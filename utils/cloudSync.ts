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

const AUTH_CODE_STORAGE_KEY = "syncAuthCode"

const isExtensionContext = typeof chrome !== "undefined" && !!chrome.storage?.local

async function readSecureAuthCode(): Promise<string> {
  const legacyCode = () => String(window.localStorage.getItem(AUTH_CODE_STORAGE_KEY) || "").trim()

  if (isExtensionContext) {
    try {
      const result = await chrome.storage.local.get(AUTH_CODE_STORAGE_KEY)
      const storedCode = String(result?.[AUTH_CODE_STORAGE_KEY] || "").trim()
      if (storedCode) {
        window.localStorage.removeItem(AUTH_CODE_STORAGE_KEY)
        return storedCode
      }

      const code = legacyCode()
      if (code) {
        await chrome.storage.local.set({ [AUTH_CODE_STORAGE_KEY]: code })
        window.localStorage.removeItem(AUTH_CODE_STORAGE_KEY)
      }
      return code
    } catch {
      // fallback
    }
  }
  return legacyCode()
}

export async function writeSecureAuthCode(code: string): Promise<void> {
  if (isExtensionContext) {
    try {
      await chrome.storage.local.set({ [AUTH_CODE_STORAGE_KEY]: code })
      window.localStorage.removeItem(AUTH_CODE_STORAGE_KEY)
      return
    } catch {
      // fallback
    }
  }
  window.localStorage.setItem(AUTH_CODE_STORAGE_KEY, code)
}

// ---------------------------------------------------------------------------
// JWT 认证:登录一次换 token,后续请求只带 Bearer,不再每次发送原始认证码
// ---------------------------------------------------------------------------

const JWT_TOKEN_STORAGE_KEY = "syncJwtToken"

type StoredJwt = { token: string; serverUrl: string; expiresAt: number }

const decodeJwtExpiryMs = (token: string): number => {
  try {
    const payloadPart = token.split(".")[1] || ""
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    if (typeof payload?.exp === "number") return payload.exp * 1000
  } catch {
    // fall through
  }
  // 服务端默认 7 天过期;解析失败时保守按 6 天算
  return Date.now() + 6 * 24 * 60 * 60 * 1000
}

const isStoredJwt = (raw: unknown): raw is StoredJwt => {
  if (!raw || typeof raw !== "object") return false
  const t = raw as StoredJwt
  return typeof t.token === "string" && typeof t.serverUrl === "string" && typeof t.expiresAt === "number"
}

async function readStoredJwt(): Promise<StoredJwt | null> {
  if (isExtensionContext) {
    try {
      const result = await chrome.storage.local.get(JWT_TOKEN_STORAGE_KEY)
      const raw = result?.[JWT_TOKEN_STORAGE_KEY]
      return isStoredJwt(raw) ? raw : null
    } catch {
      return null
    }
  }
  try {
    const raw = window.localStorage.getItem(JWT_TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isStoredJwt(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeStoredJwt(value: StoredJwt): Promise<void> {
  if (isExtensionContext) {
    try {
      await chrome.storage.local.set({ [JWT_TOKEN_STORAGE_KEY]: value })
      return
    } catch {
      // fallback
    }
  }
  try {
    window.localStorage.setItem(JWT_TOKEN_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
}

async function loginForJwt(baseUrl: string, authCode: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authCode })
  })
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`)
  const payload = await res.json().catch(() => null)
  const token = String(payload?.token || "")
  if (!token) throw new Error("Login failed: empty token")
  await writeStoredJwt({ token, serverUrl: baseUrl, expiresAt: decodeJwtExpiryMs(token) })
  return token
}

async function getAuthToken(baseUrl: string, authCode: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const stored = await readStoredJwt()
    if (stored && stored.serverUrl === baseUrl && stored.expiresAt - 60_000 > Date.now()) {
      return stored.token
    }
  }
  return loginForJwt(baseUrl, authCode)
}

/** 带 Bearer 认证的 fetch;网络错误/5xx 有限重试,遇 401 自动重新登录一次再重试 */
async function authFetch(
  baseUrl: string,
  authCode: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const doFetch = async (token: string) => {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }

  let res = await fetchWithRetry(async () => doFetch(await getAuthToken(baseUrl, authCode)))
  if (res.status === 401) {
    res = await doFetch(await getAuthToken(baseUrl, authCode, true))
  }
  return res
}

const PRIVATE_HTTP_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0$|\[::1\]$|::1$|172\.(1[6-9]|2\d|3[01])\.)/i

/**
 * 规范化并校验同步服务器地址。
 * - 仅允许 http/https
 * - 对公网主机使用明文 http 时告警(认证码/token 会被明文传输)
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error("Invalid sync server URL")
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Sync server URL must use http(s)")
  }
  if (
    parsed.protocol === "http:" &&
    !PRIVATE_HTTP_HOST_RE.test(parsed.hostname) &&
    !parsed.hostname.endsWith(".local")
  ) {
    logger.warn(
      "[CloudSync] Sync server uses plain HTTP on a public host; credentials can be intercepted. Use HTTPS."
    )
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// 同步版本号(乐观锁):记录最后一次从服务器看到的 updatedAt。
// push 时携带,服务器发现版本不一致(其他设备已推送)会返回 409。
// ---------------------------------------------------------------------------

const SYNC_BASE_VERSION_KEY = "syncBaseUpdatedAt"

const readSyncBaseVersion = (): string => {
  try {
    return String(window.localStorage.getItem(SYNC_BASE_VERSION_KEY) || "")
  } catch {
    return ""
  }
}

const writeSyncBaseVersion = (v: string): void => {
  try {
    if (v) window.localStorage.setItem(SYNC_BASE_VERSION_KEY, v)
  } catch {
    // ignore
  }
}

/** 同步冲突:服务器数据比本地基线新(其他设备推送过)。上层应提示用户先拉取。 */
export class SyncConflictError extends Error {
  serverUpdatedAt: string
  constructor(serverUpdatedAt: string) {
    super("Sync conflict: server data changed since last pull")
    this.name = "SyncConflictError"
    this.serverUpdatedAt = serverUpdatedAt
  }
}

/** 对网络错误/5xx 做有限重试(指数退避);4xx 不重试 */
async function fetchWithRetry(doFetch: () => Promise<Response>, retries = 2): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
    try {
      const res = await doFetch()
      if (res.status >= 500 && attempt < retries) continue
      return res
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed")
}

export async function readCloudSyncPrefs(): Promise<CloudSyncPrefs> {
  const syncEnabled = window.localStorage.getItem("syncEnabled") === "true"
  const autoSyncEnabled = window.localStorage.getItem("autoSyncEnabled") === "true"
  const serverUrl = String(window.localStorage.getItem("syncServerUrl") || "").trim()
  const authCode = await readSecureAuthCode()
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

export async function applyImportDataToStorage(raw: Record<string, unknown>, language: Language): Promise<void> {
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
  const baseUrl = normalizeServerUrl(serverUrl)
  const res = await authFetch(baseUrl, authCode, `/api/sync/pull?v=3`)
  if (!res.ok) throw new Error(`Pull failed: HTTP ${res.status}`)

  const payload = await res.json()
  const data = payload?.data ?? payload
  await applyImportDataToStorage(data, language)

  // 记录服务器数据版本,作为下次 push 的乐观锁基线
  if (typeof payload?.updatedAt === "string") writeSyncBaseVersion(payload.updatedAt)

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
          const iconRes = await authFetch(baseUrl, authCode, `/api/icons/${encodeURIComponent(iconId)}`)
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
  const baseUrl = normalizeServerUrl(serverUrl)
  const backupPayload = await buildBackupPayload(language)
  const settings = (backupPayload?.data?.settings ?? {}) as Record<string, unknown>
  const customIcons = (backupPayload?.data?.customIcons ?? {}) as Record<string, unknown>

  const uploadIcons = opts?.uploadIcons !== false
  const failedIconIds: string[] = []
  if (uploadIcons) {
    const iconEntries = Object.entries(customIcons)
      .filter(([, v]) => typeof v === "string" && (v as string).startsWith("data:image/")) as Array<[string, string]>

    const CONCURRENCY = 3
    for (let i = 0; i < iconEntries.length; i += CONCURRENCY) {
      const batch = iconEntries.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async ([appId, base64]) => {
          // 单个图标失败不阻断整体推送:图标可下次重传,设置数据更重要
          try {
            const converted = await ensurePngBlobFromDataUrl(base64, 256)
            if (!converted.mimeType.startsWith("image/")) throw new Error("Invalid icon type")

            try {
              const uploadRes = await authFetch(baseUrl, authCode, `/api/icons/uploadRaw/${encodeURIComponent(appId)}`, {
                method: "POST",
                headers: { "Content-Type": converted.mimeType },
                body: converted.blob
              })
              if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`)
            } catch {
              const dataUrl = await blobToDataUrl(converted.blob)
              const uploadRes = await authFetch(baseUrl, authCode, `/api/icons/upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: appId, data: dataUrl })
              })
              if (!uploadRes.ok) throw new Error(`Icon upload failed: ${appId}`)
            }
          } catch (e) {
            failedIconIds.push(appId)
            if (failedIconIds.length <= 3) {
              logger.warn("[CloudSync] push icon failed:", appId, e)
            }
          }
        })
      )
    }
  }

  // 图标清单 = 本地全部图标 id;上传失败的仍保留在清单里,避免服务端误删
  const iconManifest = Object.keys(customIcons)

  const payload = {
    version: 3,
    exportedAt: backupPayload.exportedAt,
    baseUpdatedAt: readSyncBaseVersion() || null,
    iconManifest,
    data: { settings }
  }
  const res = await authFetch(baseUrl, authCode, `/api/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => null)
    throw new SyncConflictError(String(body?.serverUpdatedAt || ""))
  }
  if (!res.ok) throw new Error(`Push failed: HTTP ${res.status}`)

  // push 成功后服务器返回新版本号,更新基线
  const body = await res.json().catch(() => null)
  if (typeof body?.updatedAt === "string") writeSyncBaseVersion(body.updatedAt)
}
