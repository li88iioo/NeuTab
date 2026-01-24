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

  const openContextMenu = (e: ReactMouseEvent, app: QuickLaunchApp, groupId: string) => {
    e.preventDefault()
    contextMenuAnchorRef.current = e.currentTarget as HTMLElement

    const menuWidth = 150
    const menuHeight = 200

    let x = e.clientX
    let y = e.clientY

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 20
    }

    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 20
    }

    setContextMenu({
      visible: true,
      x,
      y,
      appId: app.id,
      groupId
    })
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
    closeContextMenu
  }
}
