import { useEffect, useRef, useState, type RefObject } from "react"
import { beginPerfInteracting } from "@neutab/shared/utils/perfLod"

interface PageActivityOptions {
  settingsFabRef: RefObject<HTMLButtonElement | null>
  backToTopRef: RefObject<HTMLButtonElement | null>
  onToggleSettings: () => void
}

/**
 * 页面活动检测
 * @description 聚合 NewTab 的全局交互副作用:
 * - Idle 检测(3 秒无操作进入沉浸模式)
 * - 滚动状态(隐藏悬浮按钮 + perf LOD 降级)
 * - 返回顶部按钮显隐(兼容任意滚动容器)
 * - 快捷键 `s` 开关设置面板;移动端禁用多指缩放
 */
export const usePageActivity = ({ settingsFabRef, backToTopRef, onToggleSettings }: PageActivityOptions) => {
  const [isIdle, setIsIdle] = useState(false)
  const [isScrolling, setIsScrolling] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityRafRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isScrollingRef = useRef(false)
  const lastScrollContainerRef = useRef<EventTarget | null>(null)
  const scrollPerfReleaseRef = useRef<(() => void) | null>(null)
  const scrollPerfStartRef = useRef(0)
  const scrollPerfReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onToggleSettingsRef = useRef(onToggleSettings)
  onToggleSettingsRef.current = onToggleSettings

  useEffect(() => {
    /** 辅助函数:当按钮即将隐藏时移除焦点,防止 aria-hidden 与 focus 产生冲突 */
    const blurFloatingButtonsIfFocused = () => {
      const active = document.activeElement
      if (active === settingsFabRef.current || active === backToTopRef.current) {
        ; (active as HTMLElement).blur()
      }
    }

    /** 活动调度器:通过 RAF 合并高频事件回调,提高性能 */
    const scheduleActivity = () => {
      if (activityRafRef.current != null) return
      activityRafRef.current = window.requestAnimationFrame(() => {
        activityRafRef.current = null
        setIsIdle((prev) => (prev ? false : prev))

        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => {
          blurFloatingButtonsIfFocused()
          setIsIdle(true)
        }, 3000) // 3秒无操作进入闲置模式
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      scheduleActivity()
      // 快捷键 's' 打开设置面板 (排除非输入框状态)
      if (e.key.toLowerCase() === 's' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        onToggleSettingsRef.current()
      }
    }

    const handleScroll = (e?: Event) => {
      scheduleActivity()

      if (document.body.classList.contains("scroll-locked")) {
        return
      }

      if (e?.target) lastScrollContainerRef.current = e.target

      if (scrollPerfReleaseTimerRef.current) {
        clearTimeout(scrollPerfReleaseTimerRef.current)
        scrollPerfReleaseTimerRef.current = null
      }

      // 滚动时临时隐藏悬浮按钮,减少视觉干扰并防止误触
      if (!isScrollingRef.current) {
        blurFloatingButtonsIfFocused()
        isScrollingRef.current = true
        setIsScrolling(true)
        scrollPerfReleaseRef.current?.()
        scrollPerfReleaseRef.current = beginPerfInteracting()
        scrollPerfStartRef.current = performance.now()
      }
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
      scrollStopTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false
        setIsScrolling(false)
        const MIN_HOLD_MS = 280
        const elapsed = performance.now() - scrollPerfStartRef.current
        const remaining = Math.max(0, MIN_HOLD_MS - elapsed)
        if (remaining > 0) {
          scrollPerfReleaseTimerRef.current = setTimeout(() => {
            scrollPerfReleaseTimerRef.current = null
            scrollPerfReleaseRef.current?.()
            scrollPerfReleaseRef.current = null
          }, remaining)
        } else {
          scrollPerfReleaseRef.current?.()
          scrollPerfReleaseRef.current = null
        }
      }, 220)

      // 返回顶部显隐:兼容 window scroll 和任意可滚动容器(scroll 事件不冒泡)
      if (scrollRafRef.current != null) return
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null

        const scrollingEl = document.scrollingElement
        const yDocument = Math.max(
          window.scrollY || 0,
          document.documentElement.scrollTop || 0,
          document.body.scrollTop || 0,
          scrollingEl?.scrollTop || 0
        )

        const t = lastScrollContainerRef.current
        const yTarget = t && t !== document && t !== window && t instanceof HTMLElement ? t.scrollTop : 0

        const y = Math.max(yDocument, yTarget)
        const nextShow = y > 320
        setShowBackToTop((prev) => (prev === nextShow ? prev : nextShow))
      })
    }

    // Keep the launcher viewport stable on touch devices; accidental pinch zoom
    // makes dense quick-launch cards hard to hit and breaks the intended layout.
    const preventMultiTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    const preventGestureZoom = (e: Event) => e.preventDefault()

    // 默认执行一次
    scheduleActivity()

    // 全局事件监听
    window.addEventListener("mousemove", scheduleActivity, { passive: true })
    window.addEventListener("click", scheduleActivity, { passive: true })
    window.addEventListener("keydown", handleKeyDown)
    // Capture scroll from any scroll container + window scroll for compatibility.
    document.addEventListener("scroll", handleScroll, { passive: true, capture: true })
    window.addEventListener("scroll", handleScroll, { passive: true })
    document.addEventListener("touchstart", preventMultiTouchZoom, { passive: false })
    document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false })
    document.addEventListener("gesturestart", preventGestureZoom, { passive: false } as AddEventListenerOptions)
    document.addEventListener("gesturechange", preventGestureZoom, { passive: false } as AddEventListenerOptions)

    return () => {
      window.removeEventListener("mousemove", scheduleActivity)
      window.removeEventListener("click", scheduleActivity)
      window.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("scroll", handleScroll as EventListener, true)
      window.removeEventListener("scroll", handleScroll as EventListener)
      document.removeEventListener("touchstart", preventMultiTouchZoom as EventListener)
      document.removeEventListener("touchmove", preventMultiTouchZoom as EventListener)
      document.removeEventListener("gesturestart", preventGestureZoom as EventListener)
      document.removeEventListener("gesturechange", preventGestureZoom as EventListener)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
      if (scrollPerfReleaseTimerRef.current) clearTimeout(scrollPerfReleaseTimerRef.current)
      if (activityRafRef.current != null) window.cancelAnimationFrame(activityRafRef.current)
      if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current)
      scrollPerfReleaseRef.current?.()
      scrollPerfReleaseRef.current = null
      scrollPerfReleaseTimerRef.current = null
    }
    // settingsFabRef/backToTopRef 是稳定的 ref 对象;onToggleSettings 经 ref 转发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 执行回顶部 */
  const handleBackToTop = () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth"

    const t = lastScrollContainerRef.current
    if (t && t !== document && t !== window && t instanceof HTMLElement) {
      t.scrollTo?.({ top: 0, behavior })
      return
    }
    window.scrollTo({ top: 0, behavior })
  }

  return { isIdle, isScrolling, showBackToTop, handleBackToTop }
}
