import { useCallback, useEffect, useMemo, useRef } from "react"
import type * as React from "react"
import { FiPlus } from "react-icons/fi"
import AppCard from "./AppCard"
import type { QuickLaunchApp, QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { beginPerfInteracting } from "@neutab/shared/utils/perfLod"

type DragStateChange = (dragging: boolean) => void

interface QuickLaunchGroupListProps {
  groups: QuickLaunchGroup[]
  maxColumns: number
  onReorder: (groupId: string, fromIndex: number, toIndex: number) => void
  onDragStateChange?: DragStateChange
  onDragStartIntent?: () => void
  onContextMenu: (event: React.MouseEvent, app: QuickLaunchApp, groupId: string) => void
  onLongPressMenu: (
    x: number,
    y: number,
    anchor: HTMLElement,
    app: QuickLaunchApp,
    groupId: string
  ) => void
  resolveUrl?: (app: QuickLaunchApp) => string
  onAddShortcut: (groupId: string) => void
  iconCache: Record<string, string>
  labels: {
    addShortcut: string
    emptyGroupHint: string
    noRecords: string
  }
  dynamicGroupIds: {
    topSites: string
    recent: string
  }
}

type DragRuntime = {
  pointerId: number
  pointerType: string
  groupId: string
  activeId: string
  activeIndex: number
  overIndex: number
  ids: string[]
  originalIndexById: Map<string, number>
  slotRects: DOMRect[]
  elementsById: Map<string, HTMLElement>
  gridEl: HTMLElement
  gridRect: DOMRect
  columns: number
  cellW: number
  cellH: number
  originLeft: number
  originTop: number
  offsetX: number
  offsetY: number
  ghostEl: HTMLElement
  sourceEl: HTMLElement
  sourcePrevVisibility: string
  raf: number | null
  lastX: number
  lastY: number
  perfRelease: (() => void) | null
}

type PendingTouch = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  dragArmed: boolean
  cardEl: HTMLElement
  groupEl: HTMLElement
}

type PendingMouse = {
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  cardEl: HTMLElement
  groupEl: HTMLElement
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const parseGapPx = (gap: string): number => {
  // `gap` can be "16px" or "16px 20px".
  const first = gap.trim().split(/\s+/)[0] || "0"
  const n = Number(first.replace("px", ""))
  return Number.isFinite(n) ? n : 0
}

const arrayMove = <T,>(arr: T[], from: number, to: number): T[] => {
  if (from === to) return arr.slice()
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const QuickLaunchGroupList = ({
  groups,
  maxColumns,
  onReorder,
  onDragStateChange,
  onDragStartIntent,
  onContextMenu,
  onLongPressMenu,
  resolveUrl,
  onAddShortcut,
  iconCache,
  labels,
  dynamicGroupIds
}: QuickLaunchGroupListProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragRuntime | null>(null)
  const suppressTouchDragUntilRef = useRef(0)
  const touchHoldTimerRef = useRef<number | null>(null)
  const pendingTouchRef = useRef<PendingTouch | null>(null)
  const pendingMouseRef = useRef<PendingMouse | null>(null)
  const maxColumnsRef = useRef(maxColumns)
  const onReorderRef = useRef(onReorder)
  const onDragStateChangeRef = useRef(onDragStateChange)
  const onDragStartIntentRef = useRef(onDragStartIntent)

  const MOUSE_DRAG_START_THRESHOLD = 4

  useEffect(() => {
    maxColumnsRef.current = maxColumns
    onReorderRef.current = onReorder
    onDragStateChangeRef.current = onDragStateChange
    onDragStartIntentRef.current = onDragStartIntent
  }, [maxColumns, onDragStartIntent, onDragStateChange, onReorder])

  const firstNonEmptyGroup = groups.find((g) => g.apps.length > 0)
  const referenceColumns = firstNonEmptyGroup
    ? Math.min(maxColumns, firstNonEmptyGroup.apps.length)
    : maxColumns

  const groupColumns = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of groups) {
      const cols = Math.max(referenceColumns, Math.min(maxColumns, g.apps.length))
      map.set(g.id, cols)
    }
    return map
  }, [groups, maxColumns, referenceColumns])

  const endDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    const cleanup = () => {
      if (drag.raf != null) cancelAnimationFrame(drag.raf)

      for (const [id, el] of drag.elementsById) {
        el.style.transform = ""
        el.style.transition = ""
        el.style.willChange = ""
      }

      drag.sourceEl.style.visibility = drag.sourcePrevVisibility
      drag.sourceEl.removeAttribute("data-dragging")

      drag.ghostEl.remove()
      document.body.classList.remove("dragging-app-card")

      drag.perfRelease?.()
      drag.perfRelease = null

      onDragStateChangeRef.current?.(false)
    }

    if (commit && drag.overIndex !== drag.activeIndex) {
      // Commit order first, then clean up on the next frame so the hidden source
      // element can move to its new slot without a visible "jump".
      onReorderRef.current(drag.groupId, drag.activeIndex, drag.overIndex)
      requestAnimationFrame(cleanup)
      return
    }

    cleanup()
  }, [])

  const scheduleUpdate = useCallback(() => {
    const drag = dragRef.current
    if (!drag || drag.raf != null) return
    drag.raf = requestAnimationFrame(() => {
      drag.raf = null

      const x = drag.lastX
      const y = drag.lastY

      const dx = (x - drag.offsetX) - drag.originLeft
      const dy = (y - drag.offsetY) - drag.originTop
      drag.ghostEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`

      const relX = clamp(x - drag.gridRect.left, 0, Math.max(0, drag.gridRect.width - 1))
      const relY = clamp(y - drag.gridRect.top, 0, Math.max(0, drag.gridRect.height - 1))

      const col = clamp(Math.floor(relX / drag.cellW), 0, drag.columns - 1)
      const row = Math.max(0, Math.floor(relY / drag.cellH))
      const rawIndex = row * drag.columns + col
      const nextOver = clamp(rawIndex, 0, drag.ids.length - 1)

      if (nextOver === drag.overIndex) return
      drag.overIndex = nextOver

      const nextIds = arrayMove(drag.ids, drag.activeIndex, drag.overIndex)
      const targetIndexById = new Map<string, number>()
      for (let i = 0; i < nextIds.length; i += 1) targetIndexById.set(nextIds[i], i)

      for (const [id, el] of drag.elementsById) {
        if (id === drag.activeId) continue
        const fromIndex = drag.originalIndexById.get(id)
        const toIndex = targetIndexById.get(id)
        if (fromIndex == null || toIndex == null) continue

        const from = drag.slotRects[fromIndex]
        const to = drag.slotRects[toIndex]
        const tdx = to.left - from.left
        const tdy = to.top - from.top
        if (tdx === 0 && tdy === 0) {
          el.style.transform = ""
          el.style.willChange = ""
        } else {
          el.style.transform = `translate3d(${tdx}px, ${tdy}px, 0)`
          el.style.willChange = "transform"
        }
      }
    })
  }, [])

  const startDrag = useCallback((e: { pointerId: number; pointerType: string; clientX: number; clientY: number }, sourceEl: HTMLElement, groupEl: HTMLElement) => {
    const groupId = groupEl.dataset.groupId || ""
    if (!groupId) return

    const gridEl = groupEl.querySelector<HTMLElement>(".app-grid")
    if (!gridEl) return

    const activeId = sourceEl.dataset.appId || ""
    if (!activeId) return

    const cardEls = Array.from(gridEl.querySelectorAll<HTMLElement>(".app-card[data-app-id]"))
    const ids = cardEls.map((el) => el.dataset.appId || "").filter(Boolean)
    const activeIndex = ids.indexOf(activeId)
    if (activeIndex < 0) return

    const slotRects = cardEls.map((el) => el.getBoundingClientRect())
    const originalIndexById = new Map<string, number>()
    const elementsById = new Map<string, HTMLElement>()
    for (let i = 0; i < ids.length; i += 1) {
      originalIndexById.set(ids[i], i)
      elementsById.set(ids[i], cardEls[i])
    }

    const rect = sourceEl.getBoundingClientRect()
    const ghostEl = sourceEl.cloneNode(true) as HTMLElement
    ghostEl.style.position = "fixed"
    ghostEl.style.left = `${rect.left}px`
    ghostEl.style.top = `${rect.top}px`
    ghostEl.style.width = `${rect.width}px`
    ghostEl.style.height = `${rect.height}px`
    ghostEl.style.margin = "0"
    ghostEl.style.pointerEvents = "none"
    ghostEl.style.zIndex = "9999"
    ghostEl.style.transform = "translate3d(0, 0, 0)"
    ghostEl.style.willChange = "transform"
    ghostEl.setAttribute("data-dragging", "true")

    const gridRect = gridEl.getBoundingClientRect()
    const gap = parseGapPx(getComputedStyle(gridEl).gap)
    const cardW = slotRects[activeIndex]?.width || rect.width
    const cardH = slotRects[activeIndex]?.height || rect.height
    const cellW = Math.max(1, cardW + gap)
    const cellH = Math.max(1, cardH + gap)

    const columns = clamp(Number(gridEl.dataset.columns || maxColumnsRef.current || 1), 1, 20)

    const sourcePrevVisibility = sourceEl.style.visibility
    sourceEl.style.visibility = "hidden"
    sourceEl.setAttribute("data-dragging", "true")

    // Pre-set transitions once; only elements that actually move will be promoted.
    for (const [id, el] of elementsById) {
      if (id === activeId) continue
      el.style.transition = "transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1)"
    }

    document.body.appendChild(ghostEl)
    document.body.classList.add("dragging-app-card")

    dragRef.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      groupId,
      activeId,
      activeIndex,
      overIndex: activeIndex,
      ids,
      originalIndexById,
      slotRects,
      elementsById,
      gridEl,
      gridRect,
      columns,
      cellW,
      cellH,
      originLeft: rect.left,
      originTop: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      ghostEl,
      sourceEl,
      sourcePrevVisibility,
      raf: null,
      lastX: e.clientX,
      lastY: e.clientY,
      perfRelease: beginPerfInteracting()
    }

    onDragStartIntentRef.current?.()
    onDragStateChangeRef.current?.(true)
    scheduleUpdate()
  }, [scheduleUpdate])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (dragRef.current) return
      if (e.pointerType === "touch" && Date.now() < suppressTouchDragUntilRef.current) return

      const target = e.target as HTMLElement | null
      const cardEl = target?.closest<HTMLElement>(".app-card[data-app-id]")
      if (!cardEl) return

      const groupEl = cardEl.closest<HTMLElement>(".ql-group[data-group-id]")
      if (!groupEl) return
      if (groupEl.dataset.dragDisabled === "true") return

      // Touch: delay activation to allow long-press menu to win.
      if (e.pointerType === "touch") {
        if (touchHoldTimerRef.current != null) window.clearTimeout(touchHoldTimerRef.current)
        pendingTouchRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          dragArmed: false,
          cardEl,
          groupEl
        }
        // Arm drag after a short hold. Actual drag starts only when the user moves intentionally,
        // so a stationary long-press can still open the context menu (AppCard handles that).
        touchHoldTimerRef.current = window.setTimeout(() => {
          touchHoldTimerRef.current = null
          const pending = pendingTouchRef.current
          if (!pending) return
          if (pending.pointerId !== e.pointerId) return
          if (Date.now() < suppressTouchDragUntilRef.current) return
          pending.dragArmed = true
        }, 350)
        return
      }

      // Mouse/pen: do NOT start drag on pointerdown, otherwise the click gets "eaten"
      // because we hide/clone the source element immediately. Only start drag after an
      // intentional move beyond a small threshold.
      pendingMouseRef.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        cardEl,
        groupEl
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const pending = pendingTouchRef.current
      if (pending && e.pointerType === "touch" && e.pointerId === pending.pointerId) {
        pending.lastX = e.clientX
        pending.lastY = e.clientY
        const moved = Math.hypot(pending.lastX - pending.startX, pending.lastY - pending.startY)
        // If the user is scrolling, cancel the drag-arm timer quickly.
        if (moved > 20 && touchHoldTimerRef.current != null) {
          window.clearTimeout(touchHoldTimerRef.current)
          touchHoldTimerRef.current = null
          pendingTouchRef.current = null
        }

        // If drag is armed, start drag only on an intentional move (keep it higher than the
        // AppCard long-press move threshold to avoid accidental activation while holding).
        if (pending.dragArmed && moved > 8 && !dragRef.current) {
          if (Date.now() < suppressTouchDragUntilRef.current) {
            pendingTouchRef.current = null
            return
          }
          startDrag(
            { pointerId: pending.pointerId, pointerType: "touch", clientX: pending.lastX, clientY: pending.lastY },
            pending.cardEl,
            pending.groupEl
          )
          pendingTouchRef.current = null
          try {
            pending.cardEl.setPointerCapture(pending.pointerId)
          } catch {
            // ignore
          }
          return
        }
      }

      const pendingMouse = pendingMouseRef.current
      if (
        pendingMouse &&
        e.pointerId === pendingMouse.pointerId &&
        e.pointerType === pendingMouse.pointerType &&
        !dragRef.current
      ) {
        pendingMouse.lastX = e.clientX
        pendingMouse.lastY = e.clientY

        const moved = Math.hypot(pendingMouse.lastX - pendingMouse.startX, pendingMouse.lastY - pendingMouse.startY)
        if (moved > MOUSE_DRAG_START_THRESHOLD) {
          startDrag(
            { pointerId: pendingMouse.pointerId, pointerType: pendingMouse.pointerType, clientX: pendingMouse.lastX, clientY: pendingMouse.lastY },
            pendingMouse.cardEl,
            pendingMouse.groupEl
          )
          pendingMouseRef.current = null
          try {
            pendingMouse.cardEl.setPointerCapture(pendingMouse.pointerId)
          } catch {
            // ignore
          }
          return
        }
      }

      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      scheduleUpdate()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (touchHoldTimerRef.current != null) {
        window.clearTimeout(touchHoldTimerRef.current)
        touchHoldTimerRef.current = null
      }
      if (pendingTouchRef.current && e.pointerId === pendingTouchRef.current.pointerId) {
        pendingTouchRef.current = null
      }
      if (pendingMouseRef.current && e.pointerId === pendingMouseRef.current.pointerId) {
        pendingMouseRef.current = null
      }
      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      endDrag(true)
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (touchHoldTimerRef.current != null) {
        window.clearTimeout(touchHoldTimerRef.current)
        touchHoldTimerRef.current = null
      }
      if (pendingTouchRef.current && e.pointerId === pendingTouchRef.current.pointerId) {
        pendingTouchRef.current = null
      }
      if (pendingMouseRef.current && e.pointerId === pendingMouseRef.current.pointerId) {
        pendingMouseRef.current = null
      }
      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      endDrag(false)
    }

    root.addEventListener("pointerdown", onPointerDown, { capture: true })
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerup", onPointerUp, { passive: true })
    window.addEventListener("pointercancel", onPointerCancel, { passive: true })

    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("pointermove", onPointerMove as EventListener)
      window.removeEventListener("pointerup", onPointerUp as EventListener)
      window.removeEventListener("pointercancel", onPointerCancel as EventListener)
      if (touchHoldTimerRef.current != null) window.clearTimeout(touchHoldTimerRef.current)
      pendingTouchRef.current = null
      pendingMouseRef.current = null
      endDrag(false)
    }
  }, [endDrag, scheduleUpdate, startDrag])

  return (
    <div ref={rootRef}>
      {groups.map((group) => {
        const isDynamic = group.id === dynamicGroupIds.topSites || group.id === dynamicGroupIds.recent
        const displayName = group.name

        const cols = groupColumns.get(group.id) || Math.max(1, Math.min(maxColumns, group.apps.length))

        return (
          <div
            key={group.id}
            className="ql-group"
            data-group-id={group.id}
            data-drag-disabled={isDynamic ? "true" : "false"}
          >
            <div className="ql-group-inner">
              <div className="ql-group-header">
                {displayName && <h3 className="ql-group-title">{displayName}</h3>}
                {!isDynamic && (
                  <button
                    type="button"
                    className="ql-add-btn"
                    onClick={() => onAddShortcut(group.id)}
                    title={labels.addShortcut}
                  >
                    <FiPlus size={16} />
                  </button>
                )}
              </div>

              <div
                className="app-grid"
                data-columns={String(cols)}
                style={{
                  gridTemplateColumns: `repeat(${cols}, var(--grid-card-size, var(--card-size, 110px)))`
                }}
              >
                {group.apps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onContextMenu={(e) => onContextMenu(e, app, group.id)}
                    onLongPressMenu={(x, y, anchor) => {
                      suppressTouchDragUntilRef.current = Date.now() + 800
                      onLongPressMenu(x, y, anchor, app, group.id)
                    }}
                    localIconOverride={iconCache[app.id]}
                    resolveUrl={resolveUrl}
                  />
                ))}

                {group.apps.length === 0 && !isDynamic && (
                  <div className="ql-empty-hint">
                    <span className="ql-empty-hint-text">{labels.emptyGroupHint}</span>
                  </div>
                )}
                {group.apps.length === 0 && isDynamic && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      padding: "20px",
                      color: "var(--txt-tertiary)",
                      textAlign: "center",
                      fontSize: "0.9rem"
                    }}
                  >
                    {labels.noRecords}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default QuickLaunchGroupList
