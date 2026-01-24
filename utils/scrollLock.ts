let lockCount = 0
let prevBodyOverflow = ""
let prevBodyPaddingRight = ""
let prevHtmlOverflow = ""

export const lockBodyScroll = (): (() => void) => {
  if (typeof document === "undefined") {
    return () => {}
  }

  const body = document.body
  const root = document.documentElement

  if (lockCount === 0) {
    prevBodyOverflow = body.style.overflow
    prevBodyPaddingRight = body.style.paddingRight
    prevHtmlOverflow = root.style.overflow

    const scrollbarWidth = window.innerWidth - root.clientWidth
    body.style.overflow = "hidden"
    root.style.overflow = "hidden"
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }
  }

  lockCount += 1

  return () => {
    if (typeof document === "undefined") return
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
      body.style.overflow = prevBodyOverflow
      body.style.paddingRight = prevBodyPaddingRight
      root.style.overflow = prevHtmlOverflow
    }
  }
}
