import type { QuickLaunchGroup } from "../types/quickLaunch"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS, clampNumber, type ThemeMode, type VisualTheme } from "./settings"
import { normalizeEngines, normalizeGroups } from "./importNormalization"
import { sanitizeName, sanitizeUrl } from "./validation"
import { getTranslations, type Language } from "./i18n"

export type NormalizedBackupImport = {
  /** Key/value settings to write into storage (does not include groups/icons). */
  updates: Record<string, unknown>
  /** Normalized groups, if present in the import payload. */
  groups?: QuickLaunchGroup[]
  /** Base64 (data:image/...) icon map, if present in the import payload. */
  customIcons?: Record<string, string>
  /** Best-effort extracted metadata (useful for caches). */
  meta: {
    themeMode?: ThemeMode
    visualTheme?: VisualTheme
    language?: Language
  }
}

export function resolveBackupData(raw: Record<string, any>): Record<string, any> {
  const settings = raw?.settings
  if (settings && typeof settings === "object") {
    const merged: Record<string, any> = { ...(settings as any) }
    if (raw.customIcons && typeof raw.customIcons === "object") {
      merged.customIcons = raw.customIcons
    }
    return merged
  }
  return raw
}

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value === "number" && (value === 0 || value === 1)) return Boolean(value)
  return undefined
}

export function normalizeBackupImport(raw: Record<string, any>, language: Language): NormalizedBackupImport {
  const t = getTranslations(language)
  const resolved = resolveBackupData(raw)

  const updates: Record<string, unknown> = {}
  const meta: NormalizedBackupImport["meta"] = {}

  if ("searchEngines" in resolved) {
    const engines = normalizeEngines((resolved as any).searchEngines)
    if (engines) updates.searchEngines = engines
  }
  if ("currentEngine" in resolved) updates.currentEngine = String((resolved as any).currentEngine ?? "")

  // themeMode (兼容旧字段 darkMode)
  const importedThemeMode = (() => {
    const v = (resolved as any)?.themeMode
    if (v === "auto" || v === "light" || v === "dark") return v as ThemeMode
    if ("darkMode" in resolved) {
      const coerced = coerceBoolean((resolved as any).darkMode)
      if (coerced === undefined) return undefined
      return coerced ? "dark" : "light"
    }
    return undefined
  })()
  if (importedThemeMode) {
    meta.themeMode = importedThemeMode
    updates.themeMode = importedThemeMode
  }

  const importedVisualTheme = (() => {
    const v = (resolved as any)?.visualTheme
    if (v === "neumorphic" || v === "liquid-glass") return v as VisualTheme
    return undefined
  })()
  if (importedVisualTheme) {
    meta.visualTheme = importedVisualTheme
    updates.visualTheme = importedVisualTheme
  }

  const importedLanguage = (() => {
    const v = (resolved as any)?.language
    if (v === "zh" || v === "en") return v as Language
    return undefined
  })()
  if (importedLanguage) {
    meta.language = importedLanguage
    updates.language = importedLanguage
  }

  // groups
  const importedGroups = normalizeGroups((resolved as any).quickLaunchGroups, language)
  const groups = importedGroups
    ? importedGroups
    : Array.isArray((resolved as any).quickLaunchApps)
      ? [{ id: "default", name: t.default, apps: (resolved as any).quickLaunchApps }]
      : undefined

  // booleans
  for (const key of ["showClock", "showSeconds", "showSearchBar", "showTopSites", "showRecentHistory", "searchOpenInNewWindow"] as const) {
    if (!(key in resolved)) continue
    const v = coerceBoolean((resolved as any)[key])
    if (v !== undefined) updates[key] = v
  }

  // layout numbers (clamp)
  if ("contentMaxWidth" in resolved) {
    updates.contentMaxWidth = clampNumber(Number((resolved as any).contentMaxWidth), LAYOUT_LIMITS.maxWidth.min, LAYOUT_LIMITS.maxWidth.max)
  }
  if ("contentPaddingX" in resolved) {
    updates.contentPaddingX = clampNumber(Number((resolved as any).contentPaddingX), LAYOUT_LIMITS.paddingX.min, LAYOUT_LIMITS.paddingX.max)
  }
  if ("contentPaddingTop" in resolved) {
    updates.contentPaddingTop = clampNumber(Number((resolved as any).contentPaddingTop), LAYOUT_LIMITS.paddingTop.min, LAYOUT_LIMITS.paddingTop.max)
  }
  if ("contentPaddingBottom" in resolved) {
    updates.contentPaddingBottom = clampNumber(Number((resolved as any).contentPaddingBottom), LAYOUT_LIMITS.paddingBottom.min, LAYOUT_LIMITS.paddingBottom.max)
  }
  if ("iconBorderRadius" in resolved) {
    updates.iconBorderRadius = clampNumber(Number((resolved as any).iconBorderRadius), LAYOUT_LIMITS.iconBorderRadius.min, LAYOUT_LIMITS.iconBorderRadius.max)
  }
  if ("cardSize" in resolved) {
    updates.cardSize = clampNumber(Number((resolved as any).cardSize), LAYOUT_LIMITS.cardSize.min, LAYOUT_LIMITS.cardSize.max)
  }

  if ("siteTitle" in resolved) updates.siteTitle = sanitizeName(String((resolved as any).siteTitle ?? ""))
  if ("siteFavicon" in resolved) {
    const rawFavicon = String((resolved as any).siteFavicon ?? "").trim()
    const safeFavicon = (() => {
      if (!rawFavicon) return ""
      if (rawFavicon.startsWith("data:image/")) return rawFavicon
      try {
        return sanitizeUrl(rawFavicon)
      } catch {
        return ""
      }
    })()
    updates.siteFavicon = safeFavicon
  }

  // Copy remaining simple DEFAULT_SETTINGS fields when types match (forward compatible).
  for (const [key, defValue] of Object.entries(DEFAULT_SETTINGS)) {
    if (key in updates) continue
    if (!(key in resolved)) continue
    if (key === "themeMode" || key === "visualTheme" || key === "language" || key === "siteTitle" || key === "siteFavicon") continue

    const value = (resolved as any)[key]
    if (typeof defValue === "boolean") {
      const v = coerceBoolean(value)
      if (v !== undefined) updates[key] = v
      continue
    }
    if (typeof defValue === "number" && typeof value === "number" && Number.isFinite(value)) {
      updates[key] = value
      continue
    }
    if (typeof defValue === "string" && typeof value === "string") {
      updates[key] = value
    }
  }

  // Ensure currentEngine points to an existing engine after sanitization.
  if (Array.isArray(updates.searchEngines)) {
    const engines = updates.searchEngines as Array<{ id: string }>
    const current = typeof updates.currentEngine === "string" ? updates.currentEngine : ""
    if (!engines.some((e) => e.id === current)) {
      updates.currentEngine = engines[0]?.id ?? "google"
    }
  }

  // icons
  const customIcons = (() => {
    const rawIcons = (resolved as any)?.customIcons
    if (!rawIcons || typeof rawIcons !== "object") return undefined
    const next: Record<string, string> = Object.create(null)
    for (const [appId, base64] of Object.entries(rawIcons as Record<string, unknown>)) {
      if (typeof base64 === "string" && base64.startsWith("data:image/")) {
        next[String(appId)] = base64
      }
    }
    return Object.keys(next).length ? next : undefined
  })()

  return { updates, groups, customIcons, meta }
}

