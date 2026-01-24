import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy
} from "@dnd-kit/sortable"
import { FiPlus, FiExternalLink, FiEdit2, FiTrash2, FiServer } from "react-icons/fi"
import AppCard from "./AppCard"
import ShortcutModal from "./ShortcutModal"
import type { QuickLaunchApp, QuickLaunchGroup, IconStyle } from "~types/quickLaunch"
import { DEFAULT_GROUPS } from "~utils/quickLaunchDefaults"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS } from "~utils/settings"
import { getTranslations, type Language } from "~utils/i18n"
import { setChunkedData, getChunkedData } from "~utils/chunkedStorage"
import { putGroups, getGroups, putIcon, getIcon, deleteIcon } from "~utils/indexedDB"
import { logger } from "~utils/logger"
import { isAllowedNavigationUrl, sanitizeInternalUrl, sanitizeUrl } from "~utils/validation"
import "./QuickLaunch.css"

/** 常驻分组 ID：常去网站 */
const TOP_SITES_ID = "__top_sites__"
/** 常驻分组 ID：最近访问 */
const RECENT_ID = "__recent__"
/** 存储中分组数据的 Key */
const GROUPS_KEY = "quickLaunchGroups"

/**
 * BodyPortal 组件
 * @description 将子组件渲染到 `document.body` 中。
 * 独立于 QuickLaunch 定义以保持组件引用稳定，防止因父组件重绘导致弹窗内的输入框失去焦点。
 */
const BodyPortal = ({ children }: { children: React.ReactNode }) => {
  if (typeof document === "undefined") return null
  return createPortal(children, document.body)
}

/** 云同步存储实例 (Chrome Sync Storage) */
const syncStorage = new Storage()
/** 本地扩展存储实例 (Chrome Local Storage, 5MB 限制) - 用于存储主要分组数据 */
const localExtStorage = new Storage({ area: "local" })
/** 本地扩展存储实例 - 专门用于持久化 Base64 图标数据 */
const localImageExtStorage = new Storage({ area: "local" })

/**
 * 从 localStorage 中读取并转换为数字
 * @param key - 存储键名
 * @returns 解析后的数字或 null
 */
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

/**
 * 从根元素读取 CSS 变量值并转换为数字像素值
 * @param name - CSS 变量名 (如 --card-size)
 * @returns 像素数值或 null
 */
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

/**
 * 保存图标 Base64 数据到本地存储
 * @description 独立于分组数据存储，避免同步数据超过 8KB 限制。
 * 双写到 IndexedDB 和 chrome.storage.local 提供双重保障。
 * 写入顺序与读取顺序一致：优先IndexedDB，降级chrome.storage
 */
const saveLocalIcon = async (appId: string, base64: string) => {
  let idbSuccess = false

  // 1. 优先写入IndexedDB（因为getLocalIcon优先读它）
  try {
    await putIcon(appId, base64)
    idbSuccess = true
  } catch (error) {
    logger.error("Failed to save icon to IndexedDB:", error)
  }

  // 2. chrome.storage作为备份（即使IndexedDB成功也要写）
  try {
    await localImageExtStorage.set(`icon_${appId}`, base64)
  } catch (error) {
    logger.error("Failed to save icon to chrome.storage:", error)
    // 如果两个都失败，抛出异常阻止后续流程
    if (!idbSuccess) {
      throw new Error("Failed to save icon to both IndexedDB and chrome.storage")
    }
  }
}

/**
 * 从本地存储获取图标 Base64 数据
 * 优先从 IndexedDB 读取，降级到 chrome.storage.local
 */
const getLocalIcon = async (appId: string): Promise<string | null> => {
  try {
    const idbIcon = await getIcon(appId)
    if (idbIcon) return idbIcon
  } catch (error) {
    logger.warn("Failed to read icon from IndexedDB:", error)
  }
  return await localImageExtStorage.get(`icon_${appId}`) || null
}

/**
 * 从本地存储移除图标 Base64 数据
 */
const removeLocalIcon = async (appId: string) => {
  await localImageExtStorage.remove(`icon_${appId}`)
  // IndexedDB 删除失败不阻塞流程
  try {
    await deleteIcon(appId)
  } catch (error) {
    logger.warn("Failed to delete icon from IndexedDB:", error)
  }
}

/**
 * 快捷启动主组件
 * @description 管理并展示所有的快捷搜索图标，支持分组、拖拽排序、网站图标自动获取以及云同步。
 */
const QuickLaunch = () => {
  // ---------------------------------------------------------------------------
  // 核心状态与存储 Hooks
  // ---------------------------------------------------------------------------

  /** 
   * 分组数据 (核心数据)
   * @description 使用本地存储 (local area) 以支持 5MB 大容量，绕过 sync area 的 8KB 限制。
   * 初始化为空数组以防止默认图标在加载过程中产生闪烁。
   */
  const [groups, setGroups, { isLoading: isGroupsLoading }] = useStorage<QuickLaunchGroup[]>(
    { key: "quickLaunchGroups", instance: localExtStorage },
    []
  )

  /** 当前语言环境 */
  const [language] = useStorage<Language>("language", DEFAULT_SETTINGS.language)
  const t = getTranslations(language || "zh")

  /** 图标缓存：用于临时存储从本地 localImageExtStorage 读取的 Base64 图标，避免频繁磁盘读取 */
  const [iconCache, setIconCache] = useState<Record<string, string>>({})

  // 交互控制状态
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingApp, setEditingApp] = useState<QuickLaunchApp | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [urlError, setUrlError] = useState("")

  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 容器宽度：由 ResizeObserver 动态更新，用于响应式列数计算 */
  const [containerWidth, setContainerWidth] = useState(0)

  // 设置项：是否显示动态分组
  const [showTopSites] = useStorage("showTopSites", DEFAULT_SETTINGS.showTopSites)
  const [showRecentHistory] = useStorage("showRecentHistory", DEFAULT_SETTINGS.showRecentHistory)

  /** 卡片大小:优先从缓存读取以保证首屏无跳变 */
  const [cardSize, , { isLoading: loadingCardSize }] = useStorage(
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

  // 动态分组数据
  const [topSitesGroup, setTopSitesGroup] = useState<QuickLaunchGroup | null>(null)
  const [recentGroup, setRecentGroup] = useState<QuickLaunchGroup | null>(null)

  // ---------------------------------------------------------------------------
  // 数据迁移与初始化 logic
  // ---------------------------------------------------------------------------

  /**
   * Effect: 数据迁移与云端同步
   * @description 负责从多个存储源恢复数据，并选择最新的版本。
   * 处理版本兼容性和跨设备同步冲突（Last-Write-Wins）。
   *
   * 数据源优先级（按时间戳比对）：
   * 1. IndexedDB（本地持久化，带时间戳）
   * 2. Chrome Sync Storage（云端同步，带时间戳元数据）
   * 3. Chrome Local Storage（扩展本地存储）
   * 4. Legacy存储（旧版本兼容）
   */
  useEffect(() => {
    const migrateAndSync = async () => {
      try {
        // 在函数内部获取翻译，避免作为依赖项
        const currentT = getTranslations(language || "zh")

        // 并行读取所有数据源
        const [idbData, localData, chunkedData, syncData, legacyApps] = await Promise.all([
          getGroups<QuickLaunchGroup[]>().catch(err => {
            logger.warn("Failed to read from IndexedDB:", err)
            return null
          }),
          localExtStorage.get<QuickLaunchGroup[]>(GROUPS_KEY),
          getChunkedData<QuickLaunchGroup[]>(syncStorage, GROUPS_KEY),
          syncStorage.get<QuickLaunchGroup[]>(GROUPS_KEY),
          syncStorage.get<QuickLaunchApp[]>("quickLaunchApps")
        ])

        // 读取云端时间戳元数据
        const cloudTimestamp = await syncStorage.get<number>(`${GROUPS_KEY}_timestamp`).catch(() => 0)

        // 选择最新的数据源
        let latestData: QuickLaunchGroup[] | null = null
        let latestTimestamp = 0
        let latestSource = "none"

        // 1. 检查IndexedDB（带内置时间戳）
        if (idbData?.data && Array.isArray(idbData.data) && idbData.data.length > 0) {
          const ts = idbData.timestamp || 0
          if (ts > latestTimestamp) {
            latestData = idbData.data
            latestTimestamp = ts
            latestSource = "IndexedDB"
          }
        }

        // 2. 检查云端分段存储（使用元数据时间戳）
        if (Array.isArray(chunkedData) && chunkedData.length > 0) {
          const ts = cloudTimestamp || 0  // 无时间戳时应该是最旧的，避免空数据覆盖本地
          if (ts > latestTimestamp) {
            latestData = chunkedData
            latestTimestamp = ts
            latestSource = "cloud-chunked"
          }
        }

        // 3. 检查旧版云端存储（假定较旧）
        if (Array.isArray(syncData) && syncData.length > 0 && !chunkedData) {
          const ts = cloudTimestamp || 0
          if (ts > latestTimestamp) {
            latestData = syncData
            latestTimestamp = ts
            latestSource = "cloud-legacy"
          }
        }

        // 4. 检查本地扩展存储（无时间戳，给予中等优先级）
        if (Array.isArray(localData) && localData.length > 0 && !latestData) {
          latestData = localData
          latestTimestamp = Date.now() - 3600000 // 1小时前（比云端旧，但比legacy新）
          latestSource = "local"
        }

        // 5. 迁移极旧版本的单一数组格式
        if (Array.isArray(legacyApps) && legacyApps.length > 0 && !latestData) {
          logger.debug("Migrating legacy quickLaunchApps to groups")
          latestData = [{ id: "default", name: currentT.default, apps: legacyApps }]
          latestTimestamp = 0
          latestSource = "legacy"
        }

        // 6. 全新安装：使用默认数据
        if (!latestData) {
          logger.debug("New installation, using default groups")
          latestData = DEFAULT_GROUPS
          latestTimestamp = Date.now()
          latestSource = "default"
        }

        // 应用选中的数据
        logger.debug(`Restoring from ${latestSource} (timestamp: ${latestTimestamp})`)

        // 写入所有存储层
        await localExtStorage.set(GROUPS_KEY, latestData)
        setGroups(latestData)

        // 异步备份到其他存储层（失败不阻塞）
        Promise.all([
          putGroups(latestData).catch(err => logger.warn("Failed to backup to IndexedDB:", err)),
          setChunkedData(syncStorage, GROUPS_KEY, latestData).catch(err => logger.warn("Failed to sync to cloud:", err)),
          syncStorage.set(`${GROUPS_KEY}_timestamp`, latestTimestamp).catch(err => logger.warn("Failed to save timestamp:", err))
        ])

      } catch (error) {
        logger.error("Critical error in migrateAndSync:", error)
        // 降级到默认数据
        setGroups(DEFAULT_GROUPS)
      }
    }

    if (!isGroupsLoading) {
      migrateAndSync()
    }
  }, [isGroupsLoading, setGroups, language])

  // ---------------------------------------------------------------------------
  // 后台同步与动态数据加载
  // ---------------------------------------------------------------------------

  /**
   * Effect: 背景同步 (Cloud Sync)
   * @description 当分组数据变化时，自动同步到分段云存储。
   * 包含 2 秒防抖逻辑，并优先利用 requestIdleCallback 或 scheduler 来避免阻塞用户交互。
   */
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleSyncRef = useRef<number | null>(null)
  const syncRevisionRef = useRef(0)
  useEffect(() => {
    if (isGroupsLoading || !groups || groups.length === 0) return

    syncRevisionRef.current += 1
    const revision = syncRevisionRef.current

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }
    if (idleSyncRef.current && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleSyncRef.current)
      idleSyncRef.current = null
    }

    syncTimeoutRef.current = setTimeout(async () => {
      const runSync = async () => {
        // 忽略过时的任务（如果数据再次发生变化）
        if (revision !== syncRevisionRef.current) return

        const timestamp = Date.now()

        try {
          // 双写：IndexedDB + Chrome Sync Storage（带时间戳）
          // IndexedDB写入（putGroups内部已包含时间戳）
          try {
            await putGroups(groups)
          } catch (error) {
            logger.warn("Failed to sync to IndexedDB:", error)
          }

          // 云端写入（带时间戳元数据）
          await Promise.all([
            setChunkedData(syncStorage, GROUPS_KEY, groups),
            syncStorage.set(`${GROUPS_KEY}_timestamp`, timestamp)
          ])

          logger.debug(`Groups synced (timestamp: ${timestamp})`)
        } catch (error) {
          logger.warn("Failed to sync to cloud:", error)
        }
      }

      // 将压缩/字符串化等重负荷工作推迟到后台
      if ("scheduler" in window && typeof (window as Window & { scheduler?: { postTask: (fn: () => void, opts: any) => void } }).scheduler?.postTask === "function") {
        (window as any).scheduler.postTask(runSync, { priority: "background" })
        return
      }

      if (typeof window.requestIdleCallback === "function") {
        idleSyncRef.current = window.requestIdleCallback(
          () => {
            idleSyncRef.current = null
            void runSync()
          },
          { timeout: 2000 }
        )
        return
      }

      setTimeout(() => void runSync(), 0)
    }, 2000)

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      if (idleSyncRef.current && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleSyncRef.current)
        idleSyncRef.current = null
      }
    }
  }, [groups, isGroupsLoading])

  /**
   * Effect: 加载“常去网站”
   * @description 优先使用 Chromium 的 topSites API。
   * 在 Firefox 或 API 不可用时，降级使用历史记录 (visitCount) 进行加权估算。
   */
  useEffect(() => {
    if (!showTopSites) {
      setTopSitesGroup(null)
      return
    }

    if (typeof chrome !== "undefined" && chrome.topSites?.get) {
      chrome.topSites.get((sites) => {
        if (chrome.runtime?.lastError) {
          logger.warn("[topSites] Failed:", chrome.runtime.lastError.message)
          setTopSitesGroup(null)
          return
        }

        const apps: QuickLaunchApp[] = sites.slice(0, 8).map((site) => ({
          id: `top_${site.url}`,
          name: site.title,
          url: site.url,
          color: "#7f8c8d",
          iconStyle: "image"
        }))
        setTopSitesGroup({ id: TOP_SITES_ID, name: t.frequentlyVisited, apps })
      })
      return
    }

    // Firefox/降级逻辑：通过历史记录 visitCount 模拟
    if (typeof chrome !== "undefined" && chrome.history?.search) {
      chrome.history.search({ text: "", maxResults: 200 }, (items) => {
        if (chrome.runtime?.lastError) {
          logger.warn("[topSites:fallback:history] Failed:", chrome.runtime.lastError.message)
          setTopSitesGroup(null)
          return
        }

        const apps: QuickLaunchApp[] = items
          .filter((i) => {
            if (!i.url) return false
            try {
              const u = new URL(i.url)
              return u.protocol === "http:" || u.protocol === "https:"
            } catch {
              return false
            }
          })
          .sort((a, b) => {
            const av = (a as chrome.history.HistoryItem).visitCount ?? 0
            const bv = (b as chrome.history.HistoryItem).visitCount ?? 0
            if (bv !== av) return bv - av
            const at = a.lastVisitTime ?? 0
            const bt = b.lastVisitTime ?? 0
            return bt - at
          })
          .slice(0, 8)
          .map((item) => ({
            id: `top_${item.url}`,
            name: item.title || t.newTab,
            url: item.url!,
            color: "#7f8c8d",
            iconStyle: "image"
          }))

        setTopSitesGroup({ id: TOP_SITES_ID, name: t.frequentlyVisited, apps })
      })
    }
  }, [showTopSites, t.frequentlyVisited])

  /**
   * Effect: 加载“最近访问”
   * @description 通过 chrome.history API 获取最近的几条历史记录。
   */
  useEffect(() => {
    if (!showRecentHistory) {
      setRecentGroup(null)
      return
    }

    if (typeof chrome !== "undefined" && chrome.history) {
      chrome.history.search({ text: "", maxResults: 8 }, (items) => {
        if (chrome.runtime?.lastError) {
          logger.warn("[history] Failed:", chrome.runtime.lastError.message)
          setRecentGroup(null)
          return
        }

        const apps: QuickLaunchApp[] = items.filter(i => i.url).map((item) => ({
          id: `hist_${item.id}`,
          name: item.title || t.newTab,
          url: item.url!,
          color: "#95a5a6",
          iconStyle: "image"
        }))
        setRecentGroup({ id: RECENT_ID, name: t.recentlyVisited, apps })
      })
    }
  }, [showRecentHistory, t.recentlyVisited, t.newTab])

  /**
   * Effect: 异步加载本地 Base64 图标到缓存
   * @description 遍历所有应用，如果开启了自定义图标模式 (image)，则从本地存储中提取大体积 Base64 数据并放入状态中缓存。
   * 使用分批处理 (BATCH_SIZE) 以保持主线程响应。
   */
  useEffect(() => {
    if (isGroupsLoading || !groups?.length) {
      return
    }

    let active = true
    const loadIcons = async () => {
      const newCache: Record<string, string> = {}
      let hasUpdates = false
      const idsMissingFlag: string[] = []

      // 这里不要只依赖 hasLocalIcon：
      // - 该字段是一个“优化用标记”，理论上可能缺失（例如旧数据 / 手动导入 / dev 版本切换）
      // - 为了保证“上传的本地图标永远能显示”，这里对图片模式的条目做一次轻量探测读取
      const allApps = groups
        .flatMap((g) => g.apps)
        .filter((app) => (app.iconStyle ?? "image") === "image" && !iconCache[app.id])

      const BATCH_SIZE = 5
      for (let i = 0; i < allApps.length; i += BATCH_SIZE) {
        if (!active) break

        const batch = allApps.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async (app) => {
          const localIcon = await getLocalIcon(app.id)
          if (localIcon) {
            newCache[app.id] = localIcon
            hasUpdates = true
            if (app.hasLocalIcon !== true) {
              idsMissingFlag.push(app.id)
            }
          }
        }))

        await new Promise(resolve => setTimeout(resolve, 10))
      }

      if (active && hasUpdates) {
        setIconCache(prev => ({ ...prev, ...newCache }))
      }

      // 如果发现了“实际存在本地图标，但 hasLocalIcon 未标记”的条目，
      // 则在内存/存储层补上标记（避免下次还要做无意义的探测读取）。
      if (active && idsMissingFlag.length > 0) {
        const ids = new Set(idsMissingFlag)
        setGroups((prev) => {
          const current = prev?.length ? prev : DEFAULT_GROUPS
          let changed = false
          const next = current.map((g) => ({
            ...g,
            apps: g.apps.map((a) => {
              if (!ids.has(a.id)) return a
              if (a.hasLocalIcon === true) return a
              changed = true
              return { ...a, hasLocalIcon: true }
            })
          }))
          return changed ? next : current
        })
      }
    }

    loadIcons()
    return () => { active = false }
  }, [groups, isGroupsLoading])

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

  /**
   * Layout Effect: 响应式尺寸监听
   * @description 使用 ResizeObserver 监听容器宽度变化，并通过 requestAnimationFrame 节流更新。
   * 为何不使用纯 CSS Grid？因为图标大小 (card-size) 是用户可调的变量，需要 JS 计算以实现精确对齐。
   */
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
  }, [])

  /**
   * 计算当前最大列数
   * @description 根据容器宽度、卡片大小和动态间距计算。
   * 包含初始化逻辑：如果 Observer 尚未准备好，则从 CSS 变量或默认值推算，避免布局跳变。
   * 算法：(容器宽度 + 间距) / (卡片宽度 + 间距)
   */
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

    // 响应式微调：小屏下减小间距
    let responsiveGap = cardGap
    if (effectiveWidth < 400) {
      responsiveGap = Math.max(12, Math.round(cardGap * 0.6))
    } else if (effectiveWidth < 600) {
      responsiveGap = Math.max(16, Math.round(cardGap * 0.8))
    }

    const calculated = Math.floor((effectiveWidth + responsiveGap) / (actualCardSize + responsiveGap))
    return Math.max(1, Math.min(14, calculated))
  }, [containerWidth, cardSize])

  /** 右键菜单状态 */
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    appId: string | null
    groupId: string | null
  }>({ visible: false, x: 0, y: 0, appId: null, groupId: null })

  /**
   * 记录右键菜单的触发元素（用于关闭后恢复焦点）
   * @description 键盘/读屏用户关闭菜单后，应回到原来的卡片位置，避免“焦点丢失”。
   */
  const contextMenuAnchorRef = useRef<HTMLElement | null>(null)

  const closeContextMenu = () => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev))
    requestAnimationFrame(() => {
      contextMenuAnchorRef.current?.focus?.()
    })
  }

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
   * Effect: Favicon 迁移逻辑
   * @description 将旧版本的 gstatic.com 图标 URL 更新为更高清晰度的 Google S2 Favicon API。
   */
  const [faviconMigrated, setFaviconMigrated] = useState(false)
  useEffect(() => {
    if (faviconMigrated) return
    const needsMigration = safeStorageGroups.some((group) => group.apps.some((app) => app.customIcon?.includes("gstatic.com")))
    if (!needsMigration) {
      setFaviconMigrated(true)
      return
    }
    const migratedGroups = safeStorageGroups.map((group) => ({
      ...group,
      apps: group.apps.map((app) => {
        if (app.customIcon?.includes("gstatic.com")) {
          const domain = new URL(app.url).hostname.replace(/^www\./, "")
          return {
            ...app,
            customIcon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
          }
        }
        return app
      })
    }))
    setGroups(migratedGroups)
    setFaviconMigrated(true)
  }, [safeStorageGroups, setGroups, faviconMigrated])

  /**
   * Effect: 清理浏览器内部 favicon URL（避免把 chrome-extension://.../_favicon/... 持久化到配置中）
   * @description
   * 在 Chromium 下 `getBrowserFaviconUrl` 会返回 `chrome-extension://<id>/_favicon/...`。
   * 这类 URL：
   * - 与扩展 ID 强绑定（跨设备/重装会变）
   * - 在编辑弹窗中会引发“仅支持 http/https”的体验问题（用户不应手动删除）
   * - 在部分移动端扩展实现中也可能失效
   *
   * 因此这里做一次性迁移：若 customIcon 是内部 favicon endpoint，则清空。
   */
  const [internalFaviconMigrated, setInternalFaviconMigrated] = useState(false)
  useEffect(() => {
    if (internalFaviconMigrated) return
    if (!safeStorageGroups.length) {
      setInternalFaviconMigrated(true)
      return
    }

    const isInternalFavicon = (s?: string) => {
      if (!s) return false
      return (
        (s.startsWith("chrome-extension://") || s.startsWith("moz-extension://")) &&
        s.includes("/_favicon/")
      )
    }

    const needs = safeStorageGroups.some((g) => g.apps.some((a) => isInternalFavicon(a.customIcon)))
    if (!needs) {
      setInternalFaviconMigrated(true)
      return
    }

    const migrated = safeStorageGroups.map((g) => ({
      ...g,
      apps: g.apps.map((a) => {
        if (!isInternalFavicon(a.customIcon)) return a
        return { ...a, customIcon: undefined }
      })
    }))

    setGroups(migrated)
    setInternalFaviconMigrated(true)
  }, [safeStorageGroups, setGroups, internalFaviconMigrated])

  /** DND Kit 传感器配置：Pointer 距离必须超过 8px 以区分点击与拖拽 */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Close context menu on global click / Escape / viewport changes
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

  /**
   * 处理拖动结束事件
   * @description 仅在常规分组内支持排序。使用 arrayMove 更新分组内的 apps 顺序。
   */
  const handleDragEnd = (event: DragEndEvent, groupId: string) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setGroups((items) => {
      const current = items?.length ? items : DEFAULT_GROUPS
      return current.map((group) => {
        if (group.id !== groupId) return group
        const oldIndex = group.apps.findIndex((item) => item.id === String(active.id))
        const newIndex = group.apps.findIndex((item) => item.id === String(over.id))
        if (oldIndex < 0 || newIndex < 0) return group
        return {
          ...group,
          apps: arrayMove(group.apps, oldIndex, newIndex)
        }
      })
    })
  }

  /**
   * 处理右键菜单弹出
   * @description 计算弹出位置，并进行边界检查（防止菜单超出屏幕）。
   */
  const handleContextMenu = (e: React.MouseEvent, app: QuickLaunchApp, groupId: string) => {
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

  /**
   * 执行右键菜单操作
   * @param action - 操作类型：打开、编辑、删除等
   */
  const handleMenuAction = (action: "open" | "openInternal" | "edit" | "delete") => {
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
      {/* 遍历渲染分组 */}
      {displayGroups.map((group, groupIndex) => {
        const isDynamic = group.id === TOP_SITES_ID || group.id === RECENT_ID
        const displayName = group.name

        // 计算当前分组的列数，确保即便应用数较少时也能与其它分组对齐
        const firstNonEmptyGroup = displayGroups.find(g => g.apps.length > 0)
        const referenceColumns = firstNonEmptyGroup
          ? Math.min(maxColumns, firstNonEmptyGroup.apps.length)
          : maxColumns
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
                    onClick={() => {
                      setActiveGroupId(group.id)
                      setFormData({ name: "", url: "", color: "#6c5ce7", internalUrl: "", groupId: group.id, iconStyle: "image", customText: "", localIcon: "", customIcon: "" })
                      setShowAddModal(true)
                      setUrlError("")
                    }}
                    title={t.addShortcut}
                  >
                    <FiPlus size={16} />
                  </button>
                )}
              </div>

              {/* 拖拽上下文 */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => !isDynamic && handleDragEnd(event, group.id)}>
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
                        onContextMenu={(e) => handleContextMenu(e, app, group.id)}
                        // 传入本地缓存的图标，覆盖云端同步的基础数据
                        localIconOverride={iconCache[app.id]}
                      />
                    ))}

                    {/* 空状态提示 */}
                    {group.apps.length === 0 && !isDynamic && (
                      <div className="ql-empty-hint">
                        <span className="ql-empty-hint-text">{t.emptyGroupHint}</span>
                      </div>
                    )}
                    {group.apps.length === 0 && isDynamic && (
                      <div style={{ gridColumn: "1 / -1", padding: "20px", color: "var(--txt-tertiary)", textAlign: "center", fontSize: "0.9rem" }}>
                        {t.noRecords}
                      </div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )
      })}

      {/* 右键菜单 - 通过 Portal 渲染到 Body，避免 z-index 或父容器裁剪问题 */}
      {contextMenu.visible && (() => {
        const currentGroup = displayGroups.find((g) => g.id === contextMenu.groupId)
        const currentApp = currentGroup?.apps.find((a) => a.id === contextMenu.appId)
        return (
              <BodyPortal>
                <div
                  className="ql-context-menu"
                  style={{ top: contextMenu.y, left: contextMenu.x }}
                  role="menu"
                  aria-label="Quick Launch context menu"
                  onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="ql-menu-item" role="menuitem" autoFocus onClick={() => handleMenuAction("open")}>
                    <FiExternalLink size={16} /> {t.openInNewWindow}
                  </button>
                  {currentApp?.url && currentApp?.internalUrl && (
                    <button type="button" className="ql-menu-item" role="menuitem" onClick={() => handleMenuAction("openInternal")}>
                      <FiServer size={16} /> {t.openInternalUrl}
                    </button>
                  )}
                  {/* 动态分组不支持编辑/删除 */}
                  {contextMenu.groupId !== TOP_SITES_ID && contextMenu.groupId !== RECENT_ID && (
                    <>
                      <button type="button" className="ql-menu-item" role="menuitem" onClick={() => handleMenuAction("edit")}>
                        <FiEdit2 size={16} /> {t.edit}
                      </button>
                      <button type="button" className="ql-menu-item delete" role="menuitem" onClick={() => handleMenuAction("delete")}>
                        <FiTrash2 size={16} /> {t.delete}
                      </button>
                    </>
                  )}
                </div>
              </BodyPortal>
        )
      })()}

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
              const submittedLocalIcon = data.localIcon
              const wantsLocalIcon = !!submittedLocalIcon
              if (submittedLocalIcon) {
                await saveLocalIcon(editingApp.id, submittedLocalIcon)
                setIconCache((prev) => ({ ...prev, [editingApp.id]: submittedLocalIcon }))
              } else if (editingApp.hasLocalIcon) {
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

export default QuickLaunch
