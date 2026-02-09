const NAV_HOLD_OVERLAY_ID = "neutab-nav-hold-overlay"

const isExtensionPage = (): boolean => {
  if (typeof window === "undefined") return false
  const protocol = window.location.protocol
  return protocol === "chrome-extension:" || protocol === "moz-extension:" || protocol === "safari-web-extension:"
}

const getNavigationHoldColor = (): string => {
  if (typeof window === "undefined" || typeof document === "undefined") return "#e0e5ec"

  const bodyBg = window.getComputedStyle(document.body).backgroundColor
  if (bodyBg && bodyBg !== "transparent" && bodyBg !== "rgba(0, 0, 0, 0)") return bodyBg

  const varBg = window.getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
  return varBg || "#e0e5ec"
}

const ensureNavigationHoldOverlay = (): HTMLDivElement | null => {
  if (typeof document === "undefined") return null

  let overlay = document.getElementById(NAV_HOLD_OVERLAY_ID) as HTMLDivElement | null
  if (!overlay) {
    overlay = document.createElement("div")
    overlay.id = NAV_HOLD_OVERLAY_ID
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.position = "fixed"
    overlay.style.inset = "0"
    overlay.style.pointerEvents = "none"
    overlay.style.zIndex = "2147483647"
    overlay.style.opacity = "0"
    overlay.style.transition = "opacity 90ms ease"
    document.documentElement.appendChild(overlay)
  }

  overlay.style.background = getNavigationHoldColor()
  overlay.style.opacity = "1"
  return overlay
}

/**
 * 在扩展页中执行同标签跳转时，先绘制一个与主题一致的全屏遮罩，
 * 避免慢站点首屏前出现随机白块/白屏闪烁。
 */
export const navigateCurrentTab = (targetUrl: string): void => {
  if (typeof window === "undefined") return

  const navigate = () => {
    window.location.assign(targetUrl)
  }

  if (!isExtensionPage()) {
    navigate()
    return
  }

  const overlay = ensureNavigationHoldOverlay()
  if (!overlay) {
    navigate()
    return
  }

  const cleanupTimer = window.setTimeout(() => {
    overlay.remove()
  }, 2500)

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.clearTimeout(cleanupTimer)
      navigate()
    })
  })
}

