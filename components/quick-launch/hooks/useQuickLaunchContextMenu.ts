import { useEffect, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import type { QuickLaunchApp } from "~types/quickLaunch"

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  appId: string | null
  groupId: string | null
}

export const useQuickLaunchContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    appId: null,
    groupId: null
  })

  const contextMenuAnchorRef = useRef<HTMLElement | null>(null)

  const closeContextMenu = () => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev))
    requestAnimationFrame(() => {
      contextMenuAnchorRef.current?.focus?.()
    })
  }

  const resolveMenuPosition = (x: number, y: number) => {
    const menuWidth = 150
    const menuHeight = 200
    let nextX = x
    let nextY = y

    if (nextX + menuWidth > window.innerWidth) {
      nextX = window.innerWidth - menuWidth - 20
    }

    if (nextY + menuHeight > window.innerHeight) {
      nextY = window.innerHeight - menuHeight - 20
    }

    return { x: nextX, y: nextY }
  }

  const openContextMenuAt = (
    x: number,
    y: number,
    anchor: HTMLElement,
    app: QuickLaunchApp,
    groupId: string
  ) => {
    contextMenuAnchorRef.current = anchor
    const position = resolveMenuPosition(x, y)
    setContextMenu({
      visible: true,
      x: position.x,
      y: position.y,
      appId: app.id,
      groupId
    })
  }

  const openContextMenu = (e: ReactMouseEvent, app: QuickLaunchApp, groupId: string) => {
    e.preventDefault()
    openContextMenuAt(e.clientX, e.clientY, e.currentTarget as HTMLElement, app, groupId)
  }

  useEffect(() => {
    if (!contextMenu.visible) return
    const handleClick = () => closeContextMenu()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      closeContextMenu()
    }
    const handleResizeOrScroll = () => closeContextMenu()

    document.addEventListener("click", handleClick)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleResizeOrScroll)
    window.addEventListener("scroll", handleResizeOrScroll, true)

    return () => {
      document.removeEventListener("click", handleClick)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleResizeOrScroll)
      window.removeEventListener("scroll", handleResizeOrScroll, true)
    }
  }, [contextMenu.visible])

  return {
    contextMenu,
    contextMenuAnchorRef,
    openContextMenu,
    openContextMenuAt,
    closeContextMenu
  }
}
