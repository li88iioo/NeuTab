import { useEffect, useRef } from "react"
import SmartIcon from "./SmartIcon"
import type { QuickLaunchApp } from "@neutab/shared/types/quickLaunch"
import { isAllowedNavigationUrl, isHttpUrl } from "@neutab/shared/utils/validation"

/**
 * AppCard 组件属性
 */
interface AppCardProps {
  /** 应用数据对象 */
  app: QuickLaunchApp
  /** 右键菜单触发回调 */
  onContextMenu: (e: React.MouseEvent, app: QuickLaunchApp) => void
  /** 触摸长按菜单触发回调 */
  onLongPressMenu?: (x: number, y: number, anchor: HTMLElement) => void
  /** 
   * 本地图标覆盖 (Base64)
   * @description 优先于 app.localIcon，用于在 QuickLaunch 异步加载完图标缓存后实时更新显示。
   */
  localIconOverride?: string

  /**
   * Resolve the final navigation URL (e.g. auto-select internalUrl).
   * Must be synchronous to preserve user-activation (avoid popup blocking / "no response" on click).
   */
  resolveUrl?: (app: QuickLaunchApp) => string
}

// Touch: delay long-press menu so reorder drag can start first (handled by group-level native DnD).
const LONG_PRESS_DELAY = 650
// Keep this close to the native touch-drag threshold: too small cancels the menu too easily,
// too large makes drag feel unresponsive on touch devices.
const LONG_PRESS_MOVE_THRESHOLD = 8

/**
 * AppCard 组件
 * @description 快捷启动栏中的单个应用卡片，支持拖拽排序、自定义图标渲染、多方式跳转以及右键菜单。
 */
const AppCard = ({ app, onContextMenu, onLongPressMenu, localIconOverride, resolveUrl }: AppCardProps) => {
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerTypeRef = useRef<string | null>(null)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer()
    }
  }, [])

  /**
   * 处理点击事件
   * @description 
   * 1. 阻止冒泡以防止触发父级不必要的行为。
   * 2. 针对系统内部链接 (chrome://) 使用 location.href 强制跳转（window.open 通常无法打开）。
   * 3. 区分普通点击 (当前页) 和组合键点击 (新标签页)。
   */
  const handleClick = (e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    // 阻止事件冒泡，防止与 dnd-kit 或其他监听器冲突
    e.stopPropagation()

    const targetUrl = resolveUrl ? resolveUrl(app) : (app.url || app.internalUrl)
    if (targetUrl) {
      if (!isAllowedNavigationUrl(targetUrl)) return

      // 使用 window.open 在新标签页打开，避免页面刷新
      // 对于 chrome:// 等内部链接，使用 location.href
      if (!isHttpUrl(targetUrl)) {
        window.location.href = targetUrl
      } else {
        // Ctrl/Cmd + 点击在新标签页打开，普通点击在当前页打开
        if (e.ctrlKey || e.metaKey) {
          window.open(targetUrl, "_blank", "noopener,noreferrer")
        } else {
          // 使用 assign 更加显式和可靠
          window.location.assign(targetUrl)
        }
      }
    }
  }

  /**
   * 键盘导航支持
   * @description 支持 Enter 和 Space 键触发跳转，符合可访问性标准。
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const targetUrl = resolveUrl ? resolveUrl(app) : (app.url || app.internalUrl)
      if (targetUrl) {
        if (!isAllowedNavigationUrl(targetUrl)) return
        window.location.href = targetUrl
      }
    }
  }

  /**
   * 处理触摸开始
   * @description 禁用触摸选择，防止在移动端拖拽或长按时弹出系统文本选择器。
   */
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // 阻止默认的长按行为（如文本选择、系统菜单）
    e.currentTarget.style.webkitUserSelect = 'none'
    e.currentTarget.style.userSelect = 'none'
  }

  /**
   * 处理触摸结束
   */
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    // 恢复用户选择（虽然在移动端通常不需要）
    e.currentTarget.style.webkitUserSelect = 'auto'
    e.currentTarget.style.userSelect = 'auto'
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointerTypeRef.current = e.pointerType
    if (e.pointerType !== "touch" || !onLongPressMenu) return
    longPressTriggeredRef.current = false
    touchStartRef.current = { x: e.clientX, y: e.clientY }
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      // If the page is already in drag mode, don't pop a context menu.
      if (typeof document !== "undefined" && document.body.classList.contains("dragging-app-card")) {
        return
      }
      longPressTriggeredRef.current = true
      onLongPressMenu(e.clientX, e.clientY, e.currentTarget)
    }, LONG_PRESS_DELAY)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || !touchStartRef.current) return
    const deltaX = e.clientX - touchStartRef.current.x
    const deltaY = e.clientY - touchStartRef.current.y
    if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_THRESHOLD) {
      clearLongPressTimer()
      touchStartRef.current = null
    }
  }

  const handlePointerUp = () => {
    clearLongPressTimer()
    touchStartRef.current = null
  }

  const handlePointerCancel = () => {
    clearLongPressTimer()
    touchStartRef.current = null
    longPressTriggeredRef.current = false
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (lastPointerTypeRef.current === "touch") {
      e.preventDefault()
      return
    }
    onContextMenu(e, app)
  }

  return (
    <div
      className="app-card soft-out"
      data-app-id={app.id}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={0}
      role="button"
      aria-label={`${app.name} - ${app.url || app.internalUrl}`}
      onKeyDown={handleKeyDown}>

      {/* 拖拽监听器只应用于内容区域 */}
      <div
        className="app-card-content"
        onClick={handleClick}
      >
        <SmartIcon
          name={app.name}
          url={app.url || app.internalUrl || ""}
          customIcon={app.customIcon}
          fallbackColor={app.color}
          iconStyle={app.iconStyle}
          customText={app.customText}
          localIcon={localIconOverride || app.localIcon}
          hasLocalIcon={app.hasLocalIcon}
        />
        <span className="app-name">{app.name}</span>
      </div>
    </div>
  )
}

export default AppCard
