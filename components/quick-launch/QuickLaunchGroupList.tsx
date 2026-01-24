import { useState } from "react"
import type * as React from "react"
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  type Modifier,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core"
import { getEventCoordinates } from "@dnd-kit/utilities"
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable"
import { FiPlus } from "react-icons/fi"
import AppCard from "./AppCard"
import SmartIcon from "./SmartIcon"
import type { QuickLaunchApp, QuickLaunchGroup } from "~types/quickLaunch"

type DndSensors = React.ComponentProps<typeof DndContext>["sensors"]
type DndOnDragStart = React.ComponentProps<typeof DndContext>["onDragStart"]
type DndOnDragCancel = React.ComponentProps<typeof DndContext>["onDragCancel"]

interface QuickLaunchGroupListProps {
  groups: QuickLaunchGroup[]
  maxColumns: number
  sensors: DndSensors
  onDragEnd: (event: DragEndEvent, groupId: string) => void
  onDragStart?: DndOnDragStart
  onDragCancel?: DndOnDragCancel
  onContextMenu: (event: React.MouseEvent, app: QuickLaunchApp, groupId: string) => void
  onLongPressMenu: (
    x: number,
    y: number,
    anchor: HTMLElement,
    app: QuickLaunchApp,
    groupId: string
  ) => void
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

const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (draggingNodeRect && activatorEvent) {
    const activatorCoordinates = getEventCoordinates(activatorEvent)
    if (!activatorCoordinates) return transform
    const offsetX = activatorCoordinates.x - draggingNodeRect.left
    const offsetY = activatorCoordinates.y - draggingNodeRect.top
    return {
      ...transform,
      x: transform.x + offsetX - draggingNodeRect.width / 2,
      y: transform.y + offsetY - draggingNodeRect.height / 2
    }
  }
  return transform
}

const QuickLaunchGroupList = ({
  groups,
  maxColumns,
  sensors,
  onDragEnd,
  onDragStart,
  onDragCancel,
  onContextMenu,
  onLongPressMenu,
  onAddShortcut,
  iconCache,
  labels,
  dynamicGroupIds
}: QuickLaunchGroupListProps) => {
  const [activeAppId, setActiveAppId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const firstNonEmptyGroup = groups.find((g) => g.apps.length > 0)
  const referenceColumns = firstNonEmptyGroup
    ? Math.min(maxColumns, firstNonEmptyGroup.apps.length)
    : maxColumns

  const handleDragStart = (event: DragStartEvent, groupId: string) => {
    setActiveAppId(String(event.active.id))
    setActiveGroupId(groupId)
    onDragStart?.(event)
  }

  const handleDragCancel = (event: DragCancelEvent) => {
    setActiveAppId(null)
    setActiveGroupId(null)
    onDragCancel?.(event)
  }

  const handleDragEnd = (event: DragEndEvent, groupId: string, isDynamic: boolean) => {
    setActiveAppId(null)
    setActiveGroupId(null)
    if (!isDynamic) {
      onDragEnd(event, groupId)
    }
  }

  return (
    <>
      {groups.map((group) => {
        const isDynamic = group.id === dynamicGroupIds.topSites || group.id === dynamicGroupIds.recent
        const displayName = group.name
        const isActiveGroup = activeGroupId === group.id
        const activeApp = isActiveGroup
          ? group.apps.find((app) => app.id === activeAppId) || null
          : null

        // 计算当前分组的列数，确保即便应用数较少时也能与其它分组对齐
        const currentColumns = Math.max(
          referenceColumns,
          Math.min(maxColumns, group.apps.length)
        )

        return (
          <div key={group.id} className="ql-group">
            <div className="ql-group-inner">
              <div className="ql-group-header">
                {displayName && <h3 className="ql-group-title">{displayName}</h3>}
                {/* 仅非动态分组显示“新增”按钮 */}
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

              {/* 拖拽上下文 */}
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={(event) => handleDragStart(event, group.id)}
                onDragCancel={handleDragCancel}
                onDragEnd={(event) => handleDragEnd(event, group.id, isDynamic)}>
                <SortableContext items={group.apps} strategy={rectSortingStrategy} disabled={isDynamic}>
                  <div
                    className="app-grid"
                    style={{
                      gridTemplateColumns: `repeat(${currentColumns}, var(--grid-card-size, var(--card-size, 110px)))`
                    }}>
                    {group.apps.map((app) => (
                      <AppCard
                        key={app.id}
                        app={app}
                        onContextMenu={(e) => onContextMenu(e, app, group.id)}
                        onLongPressMenu={(x, y, anchor) =>
                          onLongPressMenu(x, y, anchor, app, group.id)
                        }
                        // 传入本地缓存的图标，覆盖云端同步的基础数据
                        localIconOverride={iconCache[app.id]}
                      />
                    ))}

                    {/* 空状态提示 */}
                    {group.apps.length === 0 && !isDynamic && (
                      <div className="ql-empty-hint">
                        <span className="ql-empty-hint-text">{labels.emptyGroupHint}</span>
                      </div>
                    )}
                    {group.apps.length === 0 && isDynamic && (
                      <div style={{ gridColumn: "1 / -1", padding: "20px", color: "var(--txt-tertiary)", textAlign: "center", fontSize: "0.9rem" }}>
                        {labels.noRecords}
                      </div>
                    )}
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
                  {activeApp && (
                    <div className="app-card soft-out" data-dragging="true">
                      <div className="app-card-content">
                        <SmartIcon
                          name={activeApp.name}
                          url={activeApp.url || activeApp.internalUrl || ""}
                          customIcon={activeApp.customIcon}
                          fallbackColor={activeApp.color}
                          iconStyle={activeApp.iconStyle}
                          customText={activeApp.customText}
                          localIcon={iconCache[activeApp.id]}
                          hasLocalIcon={activeApp.hasLocalIcon}
                        />
                        <span className="app-name">{activeApp.name}</span>
                      </div>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            </div>
          </div>
        )
      })}
    </>
  )
}

export default QuickLaunchGroupList
