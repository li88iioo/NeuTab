import type { QuickLaunchGroup } from "../types/quickLaunch"
import { sanitizeHexColor, sanitizeInternalUrl, sanitizeName, sanitizeUrl } from "./validation"
import { getTranslations, type Language } from "./i18n"

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

export const normalizeGroups = (raw: unknown, language: Language = "zh"): QuickLaunchGroup[] | null => {
  if (!Array.isArray(raw)) return null

  const t = getTranslations(language)

  return raw.map((group, index) => {
    const typed = group as Partial<QuickLaunchGroup>

    const appsRaw = Array.isArray(typed.apps) ? typed.apps : []
    const apps = appsRaw
      .map((app, appIndex) => {
        const a = app as any
        const id = String(a?.id ?? `${Date.now()}-${index}-${appIndex}`)
        const name = sanitizeName(String(a?.name ?? ""))
        const color = sanitizeHexColor(String(a?.color ?? "#6c5ce7"))

        const url = (() => {
          const rawUrl = String(a?.url ?? "").trim()
          if (!rawUrl) return ""
          try {
            return sanitizeUrl(rawUrl)
          } catch {
            return ""
          }
        })()

        const internalUrl = (() => {
          const rawUrl = String(a?.internalUrl ?? "").trim()
          if (!rawUrl) return ""
          try {
            return sanitizeInternalUrl(rawUrl)
          } catch {
            return ""
          }
        })()

        if (!url && !internalUrl) return null

        const iconStyleRaw = String(a?.iconStyle ?? "image")
        const iconStyle = iconStyleRaw === "text" ? "text" : "image"
        const customText = typeof a?.customText === "string" ? a.customText.slice(0, 2) : undefined

        const customIcon = (() => {
          const rawIcon = typeof a?.customIcon === "string" ? a.customIcon.trim() : ""
          if (!rawIcon) return undefined
          if (rawIcon.startsWith("data:image/")) return undefined
          try {
            return sanitizeUrl(rawIcon)
          } catch {
            return undefined
          }
        })()

        return {
          id,
          name: name || "Untitled",
          url,
          color,
          internalUrl: internalUrl || undefined,
          iconStyle,
          customText: customText || undefined,
          customIcon,
          localIcon: undefined
        }
      })
      .filter(Boolean) as any[]

    // 如果 typed.name 是字符串（包括空字符串），保留它；否则生成默认名称
    const groupName = typeof typed.name === 'string'
      ? sanitizeName(typed.name)
      : `${t.groupPrefix} ${index + 1}`

    return {
      id: String(typed.id ?? `${Date.now()}-${index}`),
      name: groupName,
      apps
    }
  })
}

export const normalizeEngines = (raw: unknown): { id: string; name: string; url: string }[] | null => {
  if (!Array.isArray(raw)) return null

  const list = raw
    .map((e, i) => {
      const obj = e as any
      const id = String(obj?.id ?? `custom_${Date.now()}_${i}`)
      const name = sanitizeName(String(obj?.name ?? ""))
      const urlRaw = String(obj?.url ?? "").trim()
      if (!name || !urlRaw) return null
      try {
        const marker = "__NEUTAB_QUERY__"
        const url = sanitizeUrl(urlRaw.replace(/%s/g, marker)).replace(new RegExp(marker, "g"), "%s")
        return { id, name, url }
      } catch {
        return null
      }
    })
    .filter(Boolean) as { id: string; name: string; url: string }[]

  return list.length > 0 ? list : null
}

