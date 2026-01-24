import { useLayoutEffect, useMemo, useState } from "react"
import type { RefObject } from "react"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS } from "~utils/settings"

const readCachedNumber = (key: string): number | null => {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

const readCssVarPx = (name: string): number | null => {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!raw) return null
    const val = raw.endsWith("px") ? raw.slice(0, -2) : raw
    const n = Number(val)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export const useQuickLaunchLayout = (
  containerRef: RefObject<HTMLDivElement>,
  cardSize: number | undefined
) => {
  const [containerWidth, setContainerWidth] = useState(0)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      const width = element.getBoundingClientRect().width
      if (width > 0) {
        setContainerWidth(width)
      }
    }
    updateWidth()

    let rafId: number
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry && entry.contentRect.width > 0) {
        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          setContainerWidth(entry.contentRect.width)
        })
      }
    })

    observer.observe(element)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [containerRef])

  const maxColumns = useMemo(() => {
    let effectiveWidth = containerWidth

    if (!effectiveWidth || effectiveWidth < 100) {
      if (typeof window !== 'undefined') {
        const cachedMaxWidth = readCachedNumber("layout_contentMaxWidth")
        const cachedPaddingX = readCachedNumber("layout_contentPaddingX")

        const cssMaxWidth = readCssVarPx("--content-max-width")
        const cssPaddingX = readCssVarPx("--content-padding-x")

        const maxWidth = cachedMaxWidth ?? cssMaxWidth ?? DEFAULT_SETTINGS.contentMaxWidth
        const paddingXRaw = cachedPaddingX ?? cssPaddingX ?? DEFAULT_SETTINGS.contentPaddingX
        const paddingX = Math.max(LAYOUT_LIMITS.paddingX.min, paddingXRaw)

        effectiveWidth = Math.min(window.innerWidth, maxWidth) - (paddingX * 2)
      } else {
        return 0
      }
    }

    const actualCardSize = cardSize || DEFAULT_SETTINGS.cardSize
    const cardGap = Math.max(20, Math.round(actualCardSize * 0.22))

    let responsiveGap = cardGap
    if (effectiveWidth < 400) {
      responsiveGap = Math.max(12, Math.round(cardGap * 0.6))
    } else if (effectiveWidth < 600) {
      responsiveGap = Math.max(16, Math.round(cardGap * 0.8))
    }

    const calculated = Math.floor((effectiveWidth + responsiveGap) / (actualCardSize + responsiveGap))
    return Math.max(1, Math.min(14, calculated))
  }, [containerWidth, cardSize])

  return { maxColumns }
}
