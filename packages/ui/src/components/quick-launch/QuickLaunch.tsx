import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import BodyPortal from "./BodyPortal"
import QuickLaunchContextMenu, { type QuickLaunchMenuAction } from "./QuickLaunchContextMenu"
import QuickLaunchGroupList from "./QuickLaunchGroupList"
import ShortcutModal from "./ShortcutModal"
import { useQuickLaunchContextMenu } from "./hooks/useQuickLaunchContextMenu"
import { useQuickLaunchDynamicGroups } from "./hooks/useQuickLaunchDynamicGroups"
import { useQuickLaunchFaviconMigrations } from "./hooks/useQuickLaunchFaviconMigrations"
import { useQuickLaunchLayout } from "./hooks/useQuickLaunchLayout"
import { RECENT_ID, TOP_SITES_ID } from "@neutab/shared/constants/quickLaunchStorage"
import { readCachedNumber } from "./quickLaunchCache"
import type { QuickLaunchApp, QuickLaunchGroup, IconStyle } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import { DEFAULT_SETTINGS } from "@neutab/shared/utils/settings"
import { getTranslations, type Language } from "@neutab/shared/utils/i18n"
import { isAllowedNavigationUrl, sanitizeInternalUrl, sanitizeUrl } from "@neutab/shared/utils/validation"
import { logger } from "@neutab/shared/utils/logger"
import "./QuickLaunch.css"

const arrayMove = <T,>(arr: T[], from: number, to: number): T[] => {
  if (from === to) return arr.slice()
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * 快捷启动主组件
 * @description 管理并展示所有的快捷搜索图标，支持分组、拖拽排序、网站图标自动获取以及云同步。
  */
type GroupsSetter = (
  value: QuickLaunchGroup[] | ((prev: QuickLaunchGroup[] | undefined) => QuickLaunchGroup[])
) => void | Promise<void>

type UseQuickLaunchGroups = (language: Language | undefined) => {
  groups: QuickLaunchGroup[] | undefined
  setGroups: GroupsSetter
  isGroupsLoading: boolean
}

type UseQuickLaunchIcons = (options: {
  groups: QuickLaunchGroup[] | undefined
  isGroupsLoading: boolean
  setGroups: GroupsSetter
}) => {
  iconCache: Record<string, string>
  setIconCache: Dispatch<SetStateAction<Record<string, string>>>
  saveLocalIcon: (appId: string, base64: string) => Promise<void>
  getLocalIcon: (appId: string) => Promise<string | null>
  removeLocalIcon: (appId: string) => Promise<void>
}

export default function QuickLaunch({
  useQuickLaunchGroups,
  useQuickLaunchIcons
}: {
  useQuickLaunchGroups: UseQuickLaunchGroups
  useQuickLaunchIcons: UseQuickLaunchIcons
}) {
  // ---------------------------------------------------------------------------
  // 核心状态与存储 Hooks
  // ---------------------------------------------------------------------------

  /** 当前语言环境 */
  const [language] = useStorage<Language>("language", DEFAULT_SETTINGS.language)
  const t = getTranslations(language || "zh")

  const { groups, setGroups, isGroupsLoading } = useQuickLaunchGroups(language)
  const { iconCache, setIconCache, saveLocalIcon, getLocalIcon, removeLocalIcon } = useQuickLaunchIcons({
    groups,
    isGroupsLoading,
    setGroups
  })

  // 交互控制状态
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingApp, setEditingApp] = useState<QuickLaunchApp | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [urlError, setUrlError] = useState("")

  const containerRef = useRef<HTMLDivElement | null>(null)

  // 设置项：是否显示动态分组
  const [showTopSites] = useStorage("showTopSites", DEFAULT_SETTINGS.showTopSites)
  const [showRecentHistory] = useStorage("showRecentHistory", DEFAULT_SETTINGS.showRecentHistory)

  /** 卡片大小:优先从缓存读取以保证首屏无跳变 */
  const [cardSize, , { isLoading: loadingCardSize }] = useStorage<number>(
    "cardSize",
    (v) => {
      // 优先使用storage中的值
      if (typeof v === "number") return v
      // 其次使用localStorage缓存
      const cached = readCachedNumber("layout_cardSize")
      if (cached && cached > 0) return cached
      // 最后使用默认值
      return DEFAULT_SETTINGS.cardSize
    }
  )

  const { topSitesGroup, recentGroup } = useQuickLaunchDynamicGroups(
    !!showTopSites,
    !!showRecentHistory,
    {
      frequentlyVisited: t.frequentlyVisited,
      recentlyVisited: t.recentlyVisited,
      newTab: t.newTab
    }
  )

  const { maxColumns } = useQuickLaunchLayout(containerRef, cardSize)

  /**
   * 组合最终显示的内部分组列表
   * @description 合并持久化的存储分组和动态生成的“常去”、“最近”分组。
   */
  const safeStorageGroups = (!isGroupsLoading && (!groups || groups.length === 0)) ? DEFAULT_GROUPS : (groups || []);

  const displayGroups = useMemo(() => {
    const list = [...safeStorageGroups]
    if (topSitesGroup && topSitesGroup.apps.length > 0) list.push(topSitesGroup)
    if (recentGroup && recentGroup.apps.length > 0) list.push(recentGroup)
    return list
  }, [safeStorageGroups, topSitesGroup, recentGroup])

  useQuickLaunchFaviconMigrations(safeStorageGroups, setGroups)

  const { contextMenu, openContextMenu, openContextMenuAt, closeContextMenu } = useQuickLaunchContextMenu()

  /** 表单数据状态：用于新增或编辑应用 */
  const [formData, setFormData] = useState<{
    name: string
    url: string
    color: string
    internalUrl: string
    groupId: string
    iconStyle: IconStyle
    customText: string
    localIcon: string
    customIcon: string
  }>({
    name: "",
    url: "",
    color: "#6c5ce7",
    internalUrl: "",
    groupId: "",
    iconStyle: "image",
    customText: "",
    localIcon: "",
    customIcon: ""
  })

  /**
   * 处理拖拽重排（拖拽期间旁路 React；仅在 drop 时 commit 一次 setGroups）。
   */
  const handleReorder = (groupId: string, fromIndex: number, toIndex: number) => {
    setGroups((items) => {
      const current = items?.length ? items : DEFAULT_GROUPS
      return current.map((group) => {
        if (group.id !== groupId) return group
        return {
          ...group,
          apps: arrayMove(group.apps, fromIndex, toIndex)
        }
      })
    })
  }

  /**
   * 处理右键菜单弹出
   * @description 计算弹出位置，并进行边界检查（防止菜单超出屏幕）。
   */
  const handleContextMenu = (e: React.MouseEvent, app: QuickLaunchApp, groupId: string) => {
    openContextMenu(e, app, groupId)
  }

  const handleLongPressMenu = (
    x: number,
    y: number,
    anchor: HTMLElement,
    app: QuickLaunchApp,
    groupId: string
  ) => {
    openContextMenuAt(x, y, anchor, app, groupId)
  }

  /**
   * 执行右键菜单操作
   * @param action - 操作类型：打开、编辑、删除等
   */
  const handleMenuAction = (action: QuickLaunchMenuAction) => {
    const group = displayGroups.find((g) => g.id === contextMenu.groupId)
    const app = group?.apps.find((a) => a.id === contextMenu.appId)
    if (!app || !group) return

    const closeMenu = () => closeContextMenu()

    switch (action) {
      case "open":
        // Close first to avoid position "jump" caused by focus/viewport changes on some mobile browsers.
        closeMenu()
        setTimeout(() => {
          const url = app.url || app.internalUrl
          if (!url || !isAllowedNavigationUrl(url)) return
          window.open(url, "_blank", "noopener,noreferrer")
        }, 0)
        return
      case "openInternal":
        if (app.internalUrl) {
          closeMenu()
          setTimeout(() => {
            if (!isAllowedNavigationUrl(app.internalUrl!)) return
            window.open(app.internalUrl!, "_blank", "noopener,noreferrer")
          }, 0)
          return
        }
        closeMenu()
        return
      case "edit":
        closeMenu()
        void openEditModal(app, group.id)
        return
      case "delete":
        closeMenu()
        deleteApp(app.id, group.id)
        return
    }
  }

  /**
   * 验证并标准化 URL
   * @description 自动补全 https:// 协议头，并验证 URL 合法性。
   */
  const validateUrl = (url: string): { valid: boolean; normalized: string } => {
    try {
      const normalized = sanitizeUrl(url)
      setUrlError("")
      return { valid: true, normalized }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Only HTTP/HTTPS")) {
        setUrlError(t.onlyHttps)
        return { valid: false, normalized: "" }
      }
      setUrlError(t.invalidUrl)
      return { valid: false, normalized: "" }
    }
  }

  const validateInternalUrl = (url: string): { valid: boolean; normalized: string } => {
    try {
      const normalized = sanitizeInternalUrl(url)
      setUrlError("")
      return { valid: true, normalized }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Only supported URL protocols")) {
        setUrlError(t.onlyInternal)
        return { valid: false, normalized: "" }
      }
      if (e instanceof Error && e.message.includes("Only HTTP/HTTPS")) {
        setUrlError(t.onlyHttps)
        return { valid: false, normalized: "" }
      }
      setUrlError(t.invalidUrl)
      return { valid: false, normalized: "" }
    }
  }

  /**
   * 保存更新后的应用
   * @description 处理应用数据更新，并支持跨分组移动应用。
   */
  const saveUpdatedApp = (app: QuickLaunchApp, targetGroupId: string) => {
    if (!editingGroupId) return
    setGroups((prevGroups) => {
      const current = prevGroups?.length ? prevGroups : DEFAULT_GROUPS
      const hasTarget = current.some((group) => group.id === targetGroupId)
      const effectiveTargetId = hasTarget ? targetGroupId : editingGroupId

      return current.map((group) => {
        // 同分组更新
        if (group.id === editingGroupId && effectiveTargetId === editingGroupId) {
          return {
            ...group,
            apps: group.apps.map((item) => (item.id === app.id ? app : item))
          }
        }
        // 跨分组：从原分组删除
        if (group.id === editingGroupId && effectiveTargetId !== editingGroupId) {
          return {
            ...group,
            apps: group.apps.filter((item) => item.id !== app.id)
          }
        }
        // 跨分组：添加到目标分组
        if (group.id === effectiveTargetId && effectiveTargetId !== editingGroupId) {
          return {
            ...group,
            apps: [...group.apps, app]
          }
        }
        return group
      })
    })
    setShowEditModal(false)
    setEditingApp(null)
    setEditingGroupId(null)
    // 重置表单
    setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId: "", iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
    setUrlError("")
  }

  /**
   * 打开编辑弹窗并填充数据
   */
  const openEditModal = async (app: QuickLaunchApp, groupId: string) => {
    setEditingApp(app)
    setEditingGroupId(groupId)
    const safeColor = /^#[0-9A-Fa-f]{6}$/.test(app.color) ? app.color : "#6c5ce7"

    // 尽量把本地图标也带进编辑弹窗，便于用户“看见/清除/替换”。
    // 这不会进入同步数据，仅作为弹窗的临时状态。
    let localIcon = iconCache[app.id] || ""
    if (!localIcon) {
      try {
        const fromStorage = await getLocalIcon(app.id)
        if (fromStorage) {
          localIcon = fromStorage
          setIconCache((prev) => ({ ...prev, [app.id]: fromStorage }))
        }
      } catch {
        // ignore
      }
    }

    setFormData({
      name: app.name,
      url: app.url,
      color: safeColor,
      internalUrl: app.internalUrl || "",
      groupId,
      // 兼容旧数据：历史上存在 auto，统一视为 image
      iconStyle: app.iconStyle === "text" ? "text" : "image",
      customText: app.customText || "",
      localIcon,
      customIcon: app.customIcon || ""
    })
    setShowEditModal(true)
    setUrlError("")
  }

  /**
   * 删除应用
   * @description 同步从分组列表中移除应用，并异步删除本地持久化的 Base64 图标。
   */
  const deleteApp = (id: string, groupId: string) => {
    removeLocalIcon(id).catch(console.error)

    setGroups((prevGroups) => {
      const current = prevGroups?.length ? prevGroups : DEFAULT_GROUPS
      return current.map((group) =>
        group.id === groupId ? { ...group, apps: group.apps.filter((app) => app.id !== id) } : group
      )
    })
  }

  // Note: We no longer persist browser-provided favicon URLs (e.g. `chrome-extension://.../_favicon/...`)
  // into app data. Favicons are derived at render time (SmartIcon/IconPreview) to avoid:
  // - editor validation friction (users shouldn't have to delete internal URLs)
  // - cross-device sync / reinstall breakage (extension IDs differ)
  // - mobile browsers that run extensions in unstable contexts

  // 移除条件渲染，使用透明度控制加载状态，防止视觉闪烁
  const isFullyLoaded = !isGroupsLoading && !loadingCardSize && maxColumns > 0
  const containerOpacity = isFullyLoaded ? 1 : 0
  const contextMenuGroup = displayGroups.find((g) => g.id === contextMenu.groupId)
  const contextMenuApp = contextMenuGroup?.apps.find((a) => a.id === contextMenu.appId) || null
  const isContextMenuDynamic = contextMenu.groupId === TOP_SITES_ID || contextMenu.groupId === RECENT_ID

  return (
    <div
      ref={containerRef}
      className="quick-launch"
      style={{
        opacity: containerOpacity,
        transition: isFullyLoaded ? 'opacity 0.3s ease' : 'none',
        minHeight: '200px'
      }}
    >
      <QuickLaunchGroupList
        groups={displayGroups}
        maxColumns={maxColumns}
        onReorder={handleReorder}
        onDragStartIntent={() => {
          if (contextMenu.visible) closeContextMenu()
        }}
        onContextMenu={handleContextMenu}
        onLongPressMenu={handleLongPressMenu}
        onAddShortcut={(groupId) => {
          setActiveGroupId(groupId)
          setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId, iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
          setShowAddModal(true)
          setUrlError("")
        }}
        iconCache={iconCache}
        labels={{ addShortcut: t.addShortcut, emptyGroupHint: t.emptyGroupHint, noRecords: t.noRecords }}
        dynamicGroupIds={{ topSites: TOP_SITES_ID, recent: RECENT_ID }}
      />

      <QuickLaunchContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        app={contextMenuApp}
        groupId={contextMenu.groupId}
        isDynamic={isContextMenuDynamic}
        labels={{ openInNewWindow: t.openInNewWindow, openInternalUrl: t.openInternalUrl, edit: t.edit, delete: t.delete }}
        onAction={handleMenuAction}
      />

      {/* 新增快捷方式弹窗 */}
      {showAddModal && (
        <BodyPortal>
          <ShortcutModal
            title={t.addShortcut}
            initialData={formData}
            groups={safeStorageGroups.map((group) => ({ id: group.id, name: group.name }))}
            onSave={async (data) => {
              const hasUrl = data.url?.trim()
              const hasInternalUrl = data.internalUrl?.trim()

              if (!data.name) return
              if (!hasUrl && !hasInternalUrl) {
                setUrlError(t.urlRequired)
                return
              }

              let normalizedUrl = ""
              if (hasUrl) {
                const { valid, normalized } = validateUrl(data.url)
                if (!valid) return
                normalizedUrl = normalized
              }

              let normalizedInternalUrl = ""
              if (hasInternalUrl) {
                const { valid, normalized } = validateInternalUrl(data.internalUrl!)
                if (!valid) return
                normalizedInternalUrl = normalized
              }

              const targetGroupId = data.groupId || activeGroupId || safeStorageGroups[0]?.id
              if (!targetGroupId) return

              const appId = Date.now().toString()

              // 如果上传了图标，则异步保存到 localImageExtStorage
              const submittedLocalIcon = data.localIcon
              if (submittedLocalIcon) {
                await saveLocalIcon(appId, submittedLocalIcon)
                setIconCache((prev) => ({ ...prev, [appId]: submittedLocalIcon }))
              }

              const app: QuickLaunchApp = {
                id: appId,
                name: data.name,
                url: normalizedUrl,
                color: data.color,
                // 仅持久化“用户提供的图标 URL”（http/https）；浏览器 favicon 在运行时渲染阶段自动推导。
                customIcon: data.customIcon || undefined,
                internalUrl: normalizedInternalUrl || undefined,
                iconStyle: data.iconStyle,
                customText: data.customText || undefined,
                hasLocalIcon: !!submittedLocalIcon
              }

              setGroups((prevGroups) => {
                const current = prevGroups?.length ? prevGroups : DEFAULT_GROUPS
                return current.map((group) =>
                  group.id === targetGroupId ? { ...group, apps: [...group.apps, app] } : group
                )
              })
              setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId: "", iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
              setShowAddModal(false)
              setActiveGroupId(null)
              setUrlError("")
            }}
            onCancel={() => {
              setShowAddModal(false)
              setActiveGroupId(null)
              setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId: "", iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
              setUrlError("")
            }}
            urlError={urlError}
            setUrlError={setUrlError}
          />
        </BodyPortal>
      )}

      {/* 编辑快捷方式弹窗 */}
      {showEditModal && (
        <BodyPortal>
          <ShortcutModal
            title={t.editShortcut}
            initialData={formData}
            groups={safeStorageGroups.map((group) => ({ id: group.id, name: group.name }))}
            onSave={async (data) => {
              if (!editingApp) return

              const hasUrl = data.url?.trim()
              const hasInternalUrl = data.internalUrl?.trim()

              if (!data.name) return
              if (!hasUrl && !hasInternalUrl) {
                setUrlError(t.urlRequired)
                return
              }

              let normalizedUrl = ""
              if (hasUrl) {
                const { valid, normalized } = validateUrl(data.url)
                if (!valid) return
                normalizedUrl = normalized
              }

              let normalizedInternalUrl = ""
              if (hasInternalUrl) {
                const { valid, normalized } = validateInternalUrl(data.internalUrl!)
                if (!valid) return
                normalizedInternalUrl = normalized
              }

              // localIcon 只存在于弹窗临时状态中；同步数据只存一个 hasLocalIcon 标志位。
              // 注意：编辑时 localIcon 可能是服务器 URL（如 /api/icons/{id}）而不是 data URL，
              // 只有新上传的 data URL 才需要保存到服务器。
              const submittedLocalIcon = data.localIcon || ""
              const isNewDataUrl = submittedLocalIcon.startsWith("data:")
              const wantsLocalIcon = !!submittedLocalIcon
              if (isNewDataUrl && submittedLocalIcon) {
                await saveLocalIcon(editingApp.id, submittedLocalIcon)
                setIconCache((prev) => ({ ...prev, [editingApp.id]: submittedLocalIcon }))
              } else if (!submittedLocalIcon && editingApp.hasLocalIcon) {
                await removeLocalIcon(editingApp.id)
                setIconCache((prev) => {
                  const next = { ...prev }
                  delete next[editingApp.id]
                  return next
                })
              }

              const updatedApp: QuickLaunchApp = {
                ...editingApp,
                name: data.name,
                url: normalizedUrl,
                color: data.color,
                customIcon: data.customIcon || undefined,
                internalUrl: normalizedInternalUrl || undefined,
                iconStyle: data.iconStyle,
                customText: data.customText || undefined,
                localIcon: undefined, // 明确清除，防止大数据进入同步流程
                hasLocalIcon: wantsLocalIcon
              }

              const targetGroupId = data.groupId || editingGroupId || safeStorageGroups[0]?.id
              if (!targetGroupId) return

              saveUpdatedApp(updatedApp, targetGroupId)
            }}
            onCancel={() => {
              setShowEditModal(false)
              setEditingApp(null)
              setEditingGroupId(null)
              setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId: "", iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
              setUrlError("")
            }}
            urlError={urlError}
            setUrlError={setUrlError}
          />
        </BodyPortal>
      )}
    </div>
  )
}
