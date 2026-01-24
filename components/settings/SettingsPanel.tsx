import React, { useEffect, useRef, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import {
  FiX, FiPlus, FiChevronUp, FiChevronDown, FiTrash2, FiDownload, FiUpload,
  FiSun, FiMoon, FiCheck, FiSliders, FiLayout, FiGlobe, FiHome, FiGrid,
  FiDatabase, FiClock, FiSearch, FiMaximize, FiMove, FiType, FiImage,
  FiMonitor, FiCircle
} from "react-icons/fi"
import type { QuickLaunchGroup } from "~types/quickLaunch"
import { DEFAULT_GROUPS } from "~utils/quickLaunchDefaults"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS, clampNumber, type ThemeMode, type VisualTheme } from "~utils/settings"
import { getTranslations, type Language } from "~utils/i18n"
import { setChunkedData } from "~utils/chunkedStorage"
import { sanitizeHexColor, sanitizeInternalUrl, sanitizeName, sanitizeUrl } from "~utils/validation"
import RangeInput from "./RangeInput"
import "./SettingsPanel.css"

interface SettingsPanelProps {
  onClose: () => void
}

const storage = new Storage()
const syncStorage = new Storage() // for chunked cloud sync
const localExtStorage = new Storage({ area: "local" }) // local storage for groups (5MB limit)
const localImageExtStorage = new Storage({ area: "local" }) // for Base64 images

type SectionKey = "personalization" | "layout" | "site" | "groups" | "backup"

/**
 * 设置面板组件
 * @description 
 * 提供浏览器扩展的所有配置入口，包括：
 * 1. 个性化：视觉主题、多语言、组件显隐控制。
 * 2. 布局控制：最大宽度、内边距、图标圆角和尺寸（支持 60fps 实时预览）。
 * 3. 站点设置：标题、Favicon 客制化。
 * 4. 分组管理：新增、重命名、排序、删除分组。
 * 5. 备份与还原：支持全量配置和自定义图标 Base64 数据的导入导出。
 */
const SettingsPanel = ({ onClose }: SettingsPanelProps) => {
  // ---------------------------------------------------------------------------
  // 核心存储 Hooks (Plasmo useStorage)
  // ---------------------------------------------------------------------------

  /** 颜色模式：自动、浅色、深色 */
  const [themeMode, setThemeMode] = useStorage<ThemeMode>("themeMode", DEFAULT_SETTINGS.themeMode)
  /** 视觉风格：新形态 (Neumorphic)、流光玻璃 (Liquid Glass) */
  const [visualTheme, setVisualTheme] = useStorage<VisualTheme>("visualTheme", DEFAULT_SETTINGS.visualTheme)
  /** 界面语言 */
  const [language, setLanguage] = useStorage<Language>("language", DEFAULT_SETTINGS.language)

  // 组件显隐状态
  const [showClock, setShowClock] = useStorage("showClock", DEFAULT_SETTINGS.showClock)
  const [showSeconds, setShowSeconds] = useStorage("showSeconds", DEFAULT_SETTINGS.showSeconds)
  const [showSearchBar, setShowSearchBar] = useStorage("showSearchBar", DEFAULT_SETTINGS.showSearchBar)
  const [showTopSites, setShowTopSites] = useStorage("showTopSites", DEFAULT_SETTINGS.showTopSites)
  const [showRecentHistory, setShowRecentHistory] = useStorage("showRecentHistory", DEFAULT_SETTINGS.showRecentHistory)

  // 布局与尺寸状态
  const [contentMaxWidth, setContentMaxWidth] = useStorage("contentMaxWidth", DEFAULT_SETTINGS.contentMaxWidth)
  const [contentPaddingX, setContentPaddingX] = useStorage("contentPaddingX", DEFAULT_SETTINGS.contentPaddingX)
  const [contentPaddingTop, setContentPaddingTop] = useStorage("contentPaddingTop", DEFAULT_SETTINGS.contentPaddingTop)
  const [contentPaddingBottom, setContentPaddingBottom] = useStorage("contentPaddingBottom", DEFAULT_SETTINGS.contentPaddingBottom)
  const [iconBorderRadius, setIconBorderRadius] = useStorage("iconBorderRadius", DEFAULT_SETTINGS.iconBorderRadius)
  const [cardSize, setCardSize] = useStorage("cardSize", DEFAULT_SETTINGS.cardSize)

  /** 浏览器标签页标题与 Favicon */
  const [siteTitle, setSiteTitle] = useStorage("siteTitle", DEFAULT_SETTINGS.siteTitle)
  const [siteFavicon, setSiteFavicon] = useStorage("siteFavicon", DEFAULT_SETTINGS.siteFavicon)

  /** 
   * 快捷启动分组数据
   * @description 使用 extension local area (5MB) 存储分组数据；sync area 的 8KB 限制无法承载多个图标。
   */
  const [groups, setGroups] = useStorage<QuickLaunchGroup[]>(
    { key: "quickLaunchGroups", instance: localExtStorage },
    DEFAULT_GROUPS
  )

  // ---------------------------------------------------------------------------
  // 生命周期与副作用
  // ---------------------------------------------------------------------------

  /**
   * Effect: 面板开启时的交互优化
   * @description 
   * 1. 锁定 Body 滚动，并补偿滚动条宽度，防止背景页面抖动。
   * 2. 记录当前焦点，确保关闭面板后焦点能够正确返还。
   * 3. 注册 Esc 快捷键关闭监听。
   */
  useEffect(() => {
    // 获取隐藏前滚动条宽度以进行像素补偿
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    previousFocusRef.current = document.activeElement as HTMLElement

    document.body.style.overflow = "hidden"
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = ""
      document.body.style.paddingRight = ""
      document.removeEventListener('keydown', handleEscape)
      if (previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
    }
  }, [onClose])

  const t = getTranslations(language || "zh")

  /**
   * 更新同步缓存
   * @description 将主题状态同步到 localStorage 的缓存 Key 中，由 restoreTheme.ts 任务读取，
   * 以实现在 Chrome Storage 异步加载完成前的秒级背景渲染，消除白屏/主题闪烁。
   */
  const commitThemeCache = (nextMode: ThemeMode | undefined, nextVisual: VisualTheme | undefined) => {
    try {
      window.localStorage.setItem("theme_mode_cache", nextMode || "auto")
      window.localStorage.setItem("visual_theme_cache", nextVisual || "neumorphic")
    } catch {
      // 忽略隐私模式下的存储错误
    }
  }

  /**
   * 同步布局缓存
   * @description 将布局参数同步到 localStorage，以便 restoreTheme.ts 能够立即应用布局，防止首屏跳动。
   */
  const commitLayoutCache = (key: string, value: any) => {
    try {
      window.localStorage.setItem(key, String(value))
    } catch {
      // 忽略隐私模式下的存储错误
    }
  }

  /** 循切换主题颜色模式：自动 -> 浅色 -> 深色 */
  const cycleTheme = () => {
    const modes: ThemeMode[] = ["auto", "light", "dark"]
    const currentIndex = modes.indexOf(themeMode || "auto")
    const nextIndex = (currentIndex + 1) % modes.length
    const nextMode = modes[nextIndex]
    commitThemeCache(nextMode, visualTheme || "neumorphic")
    void setThemeMode(nextMode)
  }

  const getThemeIcon = () => {
    switch (themeMode) {
      case "light": return <FiSun size={18} />
      case "dark": return <FiMoon size={18} />
      default: return <FiMonitor size={18} />
    }
  }

  const getThemeLabel = () => {
    const modeLabel = (() => {
      switch (themeMode) {
        case "light": return t.themeLight
        case "dark": return t.themeDark
        default: return t.themeAuto
      }
    })()
    return `${t.themePrefix}: ${modeLabel}`
  }

  /** 切换中英文环境 */
  const cycleLanguage = () => {
    setLanguage(language === "zh" ? "en" : "zh")
  }

  const getLanguageLabel = () => {
    const langName = language === "en" ? "English" : "中文"
    return `${t.language}: ${langName}`
  }

  // ---------------------------------------------------------------------------
  // 预览状态 (Drafts)
  // ---------------------------------------------------------------------------

  const [siteTitleDraft, setSiteTitleDraft] = useState(siteTitle ?? "")
  const [siteFaviconDraft, setSiteFaviconDraft] = useState(siteFavicon ?? "")
  const [contentMaxWidthDraft, setContentMaxWidthDraft] = useState(contentMaxWidth)
  const [contentPaddingXDraft, setContentPaddingXDraft] = useState(Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingX))
  const [contentPaddingTopDraft, setContentPaddingTopDraft] = useState(contentPaddingTop)
  const [contentPaddingBottomDraft, setContentPaddingBottomDraft] = useState(contentPaddingBottom)
  const [iconBorderRadiusDraft, setIconBorderRadiusDraft] = useState(iconBorderRadius)
  const [cardSizeDraft, setCardSizeDraft] = useState(cardSize)

  // 其它交互状态
  const [groupNameDrafts, setGroupNameDrafts] = useState<Record<string, string>>({})
  const [newGroupName, setNewGroupName] = useState("")
  const [importStatus, setImportStatus] = useState<{ type: "error" | "success"; message: string } | null>(null)
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const visualThemeSelectRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const [isVisualThemeOpen, setIsVisualThemeOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionKey>("site")

  const safeGroups = groups?.length ? groups : DEFAULT_GROUPS
  const currentVisualTheme = visualTheme || "neumorphic"

  const visualThemeOptions: { value: VisualTheme; label: string }[] = [
    { value: "neumorphic", label: t.themeNeumorphic },
    { value: "liquid-glass", label: t.themeLiquidGlass }
  ]

  const currentVisualThemeLabel = visualThemeOptions.find((option) => option.value === currentVisualTheme)?.label ?? t.themeNeumorphic

  /** 侧边导航栏配置 */
  const sections: { key: SectionKey; label: string; iconClass: string; icon: React.ReactNode }[] = [
    { key: "site", label: t.site, iconClass: "icon-site", icon: <FiHome size={16} /> },
    { key: "personalization", label: t.personalization, iconClass: "icon-personalization", icon: <FiSliders size={16} /> },
    { key: "layout", label: t.layout, iconClass: "icon-layout", icon: <FiLayout size={16} /> },
    { key: "groups", label: t.groups, iconClass: "icon-groups", icon: <FiGrid size={16} /> },
    { key: "backup", label: t.backup, iconClass: "icon-backup", icon: <FiDatabase size={16} /> }
  ]

  /** 数据同步至预览 Draft 状态 */
  useEffect(() => {
    setSiteTitleDraft(siteTitle ?? "")
    setSiteFaviconDraft(siteFavicon ?? "")
    setContentMaxWidthDraft(contentMaxWidth)
    setContentPaddingXDraft(Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingX))
    setContentPaddingTopDraft(contentPaddingTop)
    setContentPaddingBottomDraft(contentPaddingBottom)
    setIconBorderRadiusDraft(iconBorderRadius)
    setCardSizeDraft(cardSize)
  }, [siteTitle, siteFavicon, contentMaxWidth, contentPaddingX, contentPaddingTop, contentPaddingBottom, iconBorderRadius, cardSize])

  // Normalize legacy/invalid padding values into the supported range.
  useEffect(() => {
    if (typeof contentPaddingX !== "number") return
    if (contentPaddingX >= LAYOUT_LIMITS.paddingX.min) return
    const next = LAYOUT_LIMITS.paddingX.min
    setContentPaddingXDraft(next)
    commitLayoutCache("layout_contentPaddingX", next)
    void setContentPaddingX(next)
  }, [contentPaddingX, setContentPaddingX])

  useEffect(() => {
    if (!isVisualThemeOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (visualThemeSelectRef.current && !visualThemeSelectRef.current.contains(event.target as Node)) {
        setIsVisualThemeOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isVisualThemeOpen])

  /** 
   * Effect: 实时视觉预览同步
   * @description 将 Draft 状态中的数值实时应用到 document 根元素的 CSS 变量中。
   * 这里包含了精细的布局计算：
   * 1. 自动计算 `--card-gap` 和 `--card-scale`。
   * 2. 非线性阴影缩放：根据卡片大小动态调整阴影的偏移和模糊度，确保大卡片大气、小卡片精致。
   */
  const isInitialMount = useRef(true)

  useEffect(() => {
    // 跳过初始挂载，避免覆盖 newtab.tsx 已经基于缓存恢复的值
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    const root = document.documentElement
    root.style.setProperty("--content-max-width", `${contentMaxWidthDraft}px`)
    const effectivePaddingX = Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingXDraft)
    root.style.setProperty("--content-padding-x", `${effectivePaddingX}px`)
    root.style.setProperty("--content-padding-top", `${contentPaddingTopDraft}px`)
    root.style.setProperty("--content-padding-bottom", `${contentPaddingBottomDraft}px`)
    root.style.setProperty("--card-radius", `${iconBorderRadiusDraft}%`)
    root.style.setProperty("--card-size", `${cardSizeDraft}px`)
    root.style.setProperty("--card-scale", String(cardSizeDraft / 110))
    const cardGap = Math.max(20, Math.round(cardSizeDraft * 0.22))
    root.style.setProperty("--card-gap", `${cardGap}px`)

    // Keep SettingsPanel live preview in sync with `applyLayoutVariables` behavior (grid-only scaling).
    const padDelta = effectivePaddingX - DEFAULT_SETTINGS.contentPaddingX
    const gridScale = Math.max(0.75, Math.min(1.15, 1 - padDelta / 500))
    const gridSize = Math.round(cardSizeDraft * gridScale * 100) / 100
    root.style.setProperty("--grid-card-size", `${gridSize}px`)
    root.style.setProperty("--grid-card-scale", String(gridSize / 110))
    const gridGap = Math.max(12, Math.round(gridSize * 0.22))
    root.style.setProperty("--grid-card-gap", `${gridGap}px`)

    // 动态阴影计算：非线性缩放避免小卡片“框感”过重
    const shadowScale = Math.pow(cardSizeDraft / 110, 1.3)
    const shadowOffset = Math.max(3, Math.round(8 * shadowScale))
    const shadowBlur = Math.max(6, Math.round(16 * shadowScale))
    const shadowOffsetIn = Math.max(2, Math.round(6 * shadowScale))
    const shadowBlurIn = Math.max(4, Math.round(10 * shadowScale))

    root.style.setProperty("--shadow-offset", `${shadowOffset}px`)
    root.style.setProperty("--shadow-blur", `${shadowBlur}px`)
    root.style.setProperty("--shadow-offset-in", `${shadowOffsetIn}px`)
    root.style.setProperty("--shadow-blur-in", `${shadowBlurIn}px`)
  }, [contentMaxWidthDraft, contentPaddingXDraft, contentPaddingTopDraft, contentPaddingBottomDraft, iconBorderRadiusDraft, cardSizeDraft])

  /** 同步分组名称预览状态 */
  useEffect(() => {
    setGroupNameDrafts((prev) => {
      const next = { ...prev }
      const ids = new Set(safeGroups.map((group) => group.id))

      safeGroups.forEach((group) => {
        const currentDraft = prev[group.id]
        const actualValue = group.name

        // 智能同步策略:
        // 1. draft不存在 → 初始化
        // 2. draft存在且与实际值不同 → 检查是否需要同步
        //    - 如果用户刚提交过(draft已trim),不覆盖
        //    - 如果是外部数据变化(如从storage加载),需要同步
        if (currentDraft === undefined) {
          // 首次初始化
          next[group.id] = actualValue
        } else if (currentDraft !== actualValue) {
          // draft与实际值不同,可能是:
          // a) 用户正在编辑(未提交) → 不覆盖
          // b) 外部数据更新(如storage加载完成) → 需要同步
          //
          // 判断依据: 如果actualValue不是"Default"且currentDraft是"Default",
          // 说明storage数据加载完成,需要同步
          const isStorageLoaded = currentDraft === "Default" && actualValue !== "Default"
          if (isStorageLoaded) {
            next[group.id] = actualValue
          }
          // 否则保持draft不变,等待用户提交
        }
      })

      // 清理已删除分组的draft
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id]
        }
      })

      return next
    })
  }, [safeGroups])

  /** 新增分组 */
  const addGroup = () => {
    const name = newGroupName.trim() || `新分组 ${safeGroups.length + 1}`
    const nextGroup: QuickLaunchGroup = {
      id: Date.now().toString(),
      name,
      apps: []
    }
    setGroups([...(safeGroups || []), nextGroup])
    setNewGroupName("")
  }

  /** 更新分组名称（预览） */
  const updateGroupName = (groupId: string, name: string) => {
    setGroupNameDrafts((prev) => ({ ...prev, [groupId]: name }))
  }

  /** 提交分组名称更改 */
  const commitGroupName = (groupId: string, name: string) => {
    const trimmed = name.trim()
    setGroupNameDrafts((prev) => ({ ...prev, [groupId]: trimmed }))
    setGroups((prevGroups) => {
      const current = prevGroups?.length ? prevGroups : DEFAULT_GROUPS
      return current.map((group) => (group.id === groupId ? { ...group, name: trimmed } : group))
    })
  }

  /** 处理输入框 Enter 提交 */
  const handleCommitOnEnter = (
    event: React.KeyboardEvent<HTMLInputElement>,
    onCommit: () => void
  ) => {
    if (event.key !== "Enter") return
    if ((event.nativeEvent as KeyboardEvent).isComposing) return // 忽略输入法合成事件
    onCommit()
    event.currentTarget.blur()
  }

  /** 移动分组顺序 */
  const moveGroup = (index: number, direction: number) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= safeGroups.length) return
    const nextGroups = [...safeGroups]
    const [item] = nextGroups.splice(index, 1)
    nextGroups.splice(targetIndex, 0, item)
    setGroups(nextGroups)
  }

  /** 删除分组流程：确认、取消、执行 */
  const confirmDeleteGroup = (groupId: string) => {
    setGroupToDelete(groupId)
  }
  const cancelDeleteGroup = () => {
    setGroupToDelete(null)
  }
  const executeDeleteGroup = (groupId: string) => {
    setGroups(safeGroups.filter((g) => g.id !== groupId))
    setGroupToDelete(null)
  }

  /** 
   * 构建备份数据包
   * @description 
   * 1. 汇总所有核心设置。
   * 2. 爬取所有快捷方式，并提取本地存储的 Base64 图标，实现全量备份。
   */
  const buildBackupPayload = async () => {
    const searchEngines = await storage.get("searchEngines")
    const currentEngine = await storage.get("currentEngine")

    // 收集所有自定义图标数据
    const customIcons: Record<string, string> = {}
    for (const group of safeGroups) {
      for (const app of group.apps) {
        const base64 = await localImageExtStorage.get(`icon_${app.id}`)
        if (typeof base64 === "string" && base64.startsWith("data:image/")) {
          customIcons[app.id] = base64
        }
      }
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        searchEngines,
        currentEngine,
        themeMode: themeMode || DEFAULT_SETTINGS.themeMode,
        visualTheme: visualTheme || DEFAULT_SETTINGS.visualTheme,
        language: language || DEFAULT_SETTINGS.language,
        quickLaunchGroups: safeGroups,
        customIcons,
        showClock,
        showSeconds,
        showSearchBar,
        showTopSites,
        showRecentHistory,
        contentMaxWidth,
        contentPaddingX: Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingX),
        contentPaddingTop,
        contentPaddingBottom,
        iconBorderRadius,
        cardSize,
        siteTitle,
        siteFavicon
      }
    }
  }

  /** 执行备份导出 */
  const handleExport = async () => {
    const payload = await buildBackupPayload()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    link.href = url
    link.download = `homepage-backup-${timestamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  /** 标准化导入的分组数据 */
  const normalizeGroups = (raw: unknown): QuickLaunchGroup[] | null => {
    if (!Array.isArray(raw)) return null
    return raw.map((group, index) => {
      const typed = group as Partial<QuickLaunchGroup>

      const appsRaw = Array.isArray(typed.apps) ? typed.apps : []
      const apps = appsRaw
        .map((app, appIndex) => {
          const a = app as any
          const id = String(a?.id ?? `${Date.now()}-${index}-${appIndex}`)
          const name = sanitizeName(String(a?.name ?? ""))
          const color = sanitizeHexColor(String(a?.color ?? "#6c5ce7"))

          const url = (() => {
            const rawUrl = String(a?.url ?? "").trim()
            if (!rawUrl) return ""
            try {
              return sanitizeUrl(rawUrl)
            } catch {
              return ""
            }
          })()

          const internalUrl = (() => {
            const rawUrl = String(a?.internalUrl ?? "").trim()
            if (!rawUrl) return ""
            try {
              return sanitizeInternalUrl(rawUrl)
            } catch {
              return ""
            }
          })()

          // Drop entries that don't have any usable navigation target after sanitization.
          if (!url && !internalUrl) return null

          // 图标风格只支持 text/image；旧数据的 auto 一律视为 image（图片模式自带“自动匹配/降级”能力）。
          const iconStyleRaw = String(a?.iconStyle ?? "image")
          const iconStyle = iconStyleRaw === "text" ? "text" : "image"

          const customText = typeof a?.customText === "string" ? a.customText.slice(0, 2) : undefined

          const customIcon = (() => {
            const rawIcon = typeof a?.customIcon === "string" ? a.customIcon.trim() : ""
            if (!rawIcon) return undefined
            // Reject base64 data URIs - they belong in customIcons dictionary, not in group data
            if (rawIcon.startsWith("data:image/")) return undefined
            // 图标 URL 作为可选项：只接受 http/https；不让内部协议/运行时 endpoint 进入配置。
            try {
              return sanitizeUrl(rawIcon)
            } catch {
              return undefined
            }
          })()

          return {
            id,
            name: name || "Untitled",
            url,
            color,
            internalUrl: internalUrl || undefined,
            iconStyle,
            customText: customText || undefined,
            customIcon,
            // Never import large Base64 blobs into group data; customIcons restore handles that separately.
            localIcon: undefined
          }
        })
        .filter(Boolean) as any[]

      return {
        id: String(typed.id ?? `${Date.now()}-${index}`),
        name: sanitizeName(String(typed.name ?? "")) || `分组 ${index + 1}`,
        apps
      }
    })
  }

  /** 标准化导入的搜索引擎列表（仅允许 http/https，并清洗字段类型） */
  const normalizeEngines = (raw: unknown): { id: string; name: string; url: string }[] | null => {
    if (!Array.isArray(raw)) return null
    const list = raw
      .map((e, i) => {
        const obj = e as any
        const id = String(obj?.id ?? `custom_${Date.now()}_${i}`)
        const name = sanitizeName(String(obj?.name ?? ""))
        const urlRaw = String(obj?.url ?? "").trim()
        if (!name || !urlRaw) return null
        try {
          const marker = "__NEUTAB_QUERY__"
          const url = sanitizeUrl(urlRaw.replace(/%s/g, marker)).replace(new RegExp(marker, "g"), "%s")
          return { id, name, url }
        } catch {
          return null
        }
      })
      .filter(Boolean) as { id: string; name: string; url: string }[]

    return list.length > 0 ? list : null
  }

  /** 
   * 处理备份文件导入
   * @description 
   * 1. 解析 JSON 数据并提取 `data` 节点。
   * 2. 执行数据清洗与标准化（Normalize），确保核心配置、搜索引擎及分组数据格式正确。
   * 3. 应用数值约束（Clamp），防止不合理的布局数值导致 UI 崩溃。
   * 4. 执行多维存储分发：常规设置存入 sync，分组数据存入 local + chunked sync，自定义图标还原至本地图标库。
   */
  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const data = parsed?.data ?? parsed
      const updates: Record<string, unknown> = {}

      // 1) 基础设置还原
      if ("searchEngines" in data) {
        const engines = normalizeEngines((data as any).searchEngines)
        if (engines) updates.searchEngines = engines
      }
      if ("currentEngine" in data) updates.currentEngine = String((data as any).currentEngine ?? "")

      // 1.1) 主题/语言（兼容旧字段 darkMode）
      const importedThemeMode = (() => {
        const raw = data?.themeMode
        if (raw === "auto" || raw === "light" || raw === "dark") return raw
        if ("darkMode" in data) return Boolean(data.darkMode) ? "dark" : "light"
        return undefined
      })()
      if (importedThemeMode) updates.themeMode = importedThemeMode

      const importedVisualTheme = (() => {
        const raw = data?.visualTheme
        if (raw === "neumorphic" || raw === "liquid-glass") return raw
        return undefined
      })()
      if (importedVisualTheme) updates.visualTheme = importedVisualTheme

      const importedLanguage = (() => {
        const raw = data?.language
        if (raw === "zh" || raw === "en") return raw
        return undefined
      })()
      if (importedLanguage) updates.language = importedLanguage

      // 2) 分组数据处理
      const importedGroups = normalizeGroups(data.quickLaunchGroups)
      if (importedGroups) {
        updates.quickLaunchGroups = importedGroups
      } else if (Array.isArray(data.quickLaunchApps)) {
        // 兼容极旧的单分组格式
        updates.quickLaunchGroups = [
          { id: "default", name: t.default, apps: data.quickLaunchApps }
        ]
      }

      // 3) 组件开关
      if ("showClock" in data) updates.showClock = Boolean(data.showClock)
      if ("showSeconds" in data) updates.showSeconds = Boolean(data.showSeconds)
      if ("showSearchBar" in data) updates.showSearchBar = Boolean(data.showSearchBar)
      if ("showTopSites" in data) updates.showTopSites = Boolean(data.showTopSites)
      if ("showRecentHistory" in data) updates.showRecentHistory = Boolean(data.showRecentHistory)

      // 4) 布局数值约束 (防止导入恶意或异常数据)
      if ("contentMaxWidth" in data) {
        updates.contentMaxWidth = clampNumber(Number(data.contentMaxWidth), LAYOUT_LIMITS.maxWidth.min, LAYOUT_LIMITS.maxWidth.max)
      }
      if ("contentPaddingX" in data) {
        updates.contentPaddingX = clampNumber(Number(data.contentPaddingX), LAYOUT_LIMITS.paddingX.min, LAYOUT_LIMITS.paddingX.max)
      }
      if ("contentPaddingTop" in data) {
        updates.contentPaddingTop = clampNumber(Number(data.contentPaddingTop), LAYOUT_LIMITS.paddingTop.min, LAYOUT_LIMITS.paddingTop.max)
      }
      if ("contentPaddingBottom" in data) {
        updates.contentPaddingBottom = clampNumber(Number(data.contentPaddingBottom), LAYOUT_LIMITS.paddingBottom.min, LAYOUT_LIMITS.paddingBottom.max)
      }
      if ("iconBorderRadius" in data) {
        updates.iconBorderRadius = clampNumber(Number(data.iconBorderRadius), LAYOUT_LIMITS.iconBorderRadius.min, LAYOUT_LIMITS.iconBorderRadius.max)
      }
      if ("cardSize" in data) {
        updates.cardSize = clampNumber(Number(data.cardSize), LAYOUT_LIMITS.cardSize.min, LAYOUT_LIMITS.cardSize.max)
      }

      if ("siteTitle" in data) updates.siteTitle = sanitizeName(String(data.siteTitle ?? ""))
      if ("siteFavicon" in data) {
        const rawFavicon = String(data.siteFavicon ?? "").trim()
        const safeFavicon = (() => {
          if (!rawFavicon) return ""
          if (rawFavicon.startsWith("data:image/")) return rawFavicon
          try {
            return sanitizeUrl(rawFavicon)
          } catch {
            return ""
          }
        })()
        updates.siteFavicon = safeFavicon
      }

      // 5) 分离保存：分组数据不应进入同步存储主 Key
      const groupsDataRaw = updates.quickLaunchGroups as QuickLaunchGroup[] | undefined
      delete updates.quickLaunchGroups

      const groupsData = groupsDataRaw ? normalizeGroups(groupsDataRaw) : undefined

      // Ensure currentEngine points to an existing engine after sanitization.
      if (Array.isArray(updates.searchEngines)) {
        const engines = updates.searchEngines as { id: string }[]
        const current = typeof updates.currentEngine === "string" ? updates.currentEngine : ""
        if (!engines.some((e) => e.id === current)) {
          updates.currentEngine = engines[0]?.id ?? "google"
        }
      }

      // 保存常规设置至 sync storage
      for (const [key, value] of Object.entries(updates)) {
        await storage.set(key, value)
      }

      // 保存分组至本地 (5MB) 与分段云存储 (Cloud Sync)
      if (groupsData) {
        await localExtStorage.set("quickLaunchGroups", groupsData)
        await setChunkedData(syncStorage, "quickLaunchGroups", groupsData)
      }

      // 6) 恢复图标库 (非同步数据)
      if (data.customIcons && typeof data.customIcons === 'object') {
        for (const [appId, base64] of Object.entries(data.customIcons)) {
          if (typeof base64 === 'string' && base64.startsWith('data:image/')) {
            await localImageExtStorage.set(`icon_${appId}`, base64)
          }
        }
      }

      // 任务完成
      // 同步更新首屏缓存，避免“导入成功后刷新仍闪一下/语言不跟随”的体感问题
      commitThemeCache(
        (updates.themeMode as ThemeMode | undefined) ?? themeMode,
        (updates.visualTheme as VisualTheme | undefined) ?? visualTheme
      )
      if (typeof updates.contentMaxWidth === "number") commitLayoutCache("layout_contentMaxWidth", updates.contentMaxWidth)
      if (typeof updates.contentPaddingX === "number") commitLayoutCache("layout_contentPaddingX", updates.contentPaddingX)
      if (typeof updates.contentPaddingTop === "number") commitLayoutCache("layout_contentPaddingTop", updates.contentPaddingTop)
      if (typeof updates.contentPaddingBottom === "number") commitLayoutCache("layout_contentPaddingBottom", updates.contentPaddingBottom)
      if (typeof updates.iconBorderRadius === "number") commitLayoutCache("layout_iconBorderRadius", updates.iconBorderRadius)
      if (typeof updates.cardSize === "number") commitLayoutCache("layout_cardSize", updates.cardSize)
      try {
        if ("showClock" in updates) window.localStorage.setItem("viz_clock", String(Boolean(updates.showClock)))
        if ("showSearchBar" in updates) window.localStorage.setItem("viz_search", String(Boolean(updates.showSearchBar)))
        if ("showSeconds" in updates) window.localStorage.setItem("viz_seconds", String(Boolean(updates.showSeconds)))
        const lang = (updates.language as string | undefined) ?? (language as string | undefined)
        if (lang === "zh" || lang === "en") window.localStorage.setItem("lang_cache", lang)
      } catch {
        // ignore
      }

      setImportStatus({ type: "success", message: t.importSuccess })
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (error) {
      console.error("Import failed:", error)
      setImportStatus({ type: "error", message: t.importFailed })
    }
  }

  // 渲染 JSX
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel soft-out" onClick={(e) => e.stopPropagation()}>
        {/* 面板头部：包含分类导航与快捷工具栏 */}
        <div className="settings-header">
          <div className="settings-top-nav-wrap">
            <nav className="settings-top-nav" aria-label={t.settings}>
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={`settings-top-nav-btn soft-out ${activeSection === section.key ? "active" : ""}`}
                  onClick={() => setActiveSection(section.key)}
                  title={section.label}
                  aria-label={section.label}
                  aria-current={activeSection === section.key ? "page" : undefined}>
                  <span className={`nav-icon ${section.iconClass}`}>{section.icon}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="settings-header-right">
            {/* 多语言切换 */}
            <button
              type="button"
              className="settings-lang-btn soft-out"
              onClick={cycleLanguage}
              title={getLanguageLabel()}>
              <FiGlobe size={18} />
            </button>
            <button
              type="button"
              className="settings-theme-btn soft-out"
              onClick={cycleTheme}
              title={getThemeLabel()}>
              {getThemeIcon()}
            </button>
            <button type="button" className="settings-close soft-out" onClick={onClose} aria-label={t.settings}>
              <FiX size={18} />
            </button>
          </div>
        </div>

        <div className="settings-body">
          <div className="settings-content">
            {activeSection === "personalization" && (
              <section className="settings-section" key="personalization">
                <h3>{t.appearanceAndDisplay}</h3>

                {/* 视觉主题岛屿 */}
                <div className="settings-island">
                  <div className="island-row">
                    <div className="row-left">
                      <div className="row-icon icon-theme">
                        <FiSliders size={18} />
                      </div>
                      <div className="row-text">
                        <span className="row-title">{t.visualTheme}</span>
                        <span className="row-desc">{t.visualThemeDesc}</span>
                      </div>
                    </div>
                    <div className="language-select" ref={visualThemeSelectRef}>
                      <button
                        type="button"
                        className="language-select-btn soft-in"
                        onClick={() => setIsVisualThemeOpen((open) => !open)}
                        aria-haspopup="listbox"
                        aria-expanded={isVisualThemeOpen}
                      >
                        <span>{currentVisualThemeLabel}</span>
                        <span className={`language-select-arrow ${isVisualThemeOpen ? "open" : ""}`}>▼</span>
                      </button>
                      {isVisualThemeOpen && (
                        <ul className="language-select-options soft-out" role="listbox">
                          {visualThemeOptions.map((option) => (
                            <li
                              key={option.value}
                              role="option"
                              aria-selected={option.value === currentVisualTheme}
                              className={`language-select-option ${option.value === currentVisualTheme ? "selected" : ""}`}
                              onClick={() => {
                                commitThemeCache(themeMode || "auto", option.value)
                                void setVisualTheme(option.value)
                                setIsVisualThemeOpen(false)
                              }}
                            >
                              {option.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* 组件显示岛屿 */}
                <div className="settings-island">
                  <div className="island-row-group">
                    <label className="island-row compact">
                      <div className="row-left">
                        <div className="row-icon icon-clock">
                          <FiClock size={18} />
                        </div>
                        <div className="row-text">
                          <span className="row-title">{t.clock}</span>
                        </div>
                      </div>
                      <div className="toggle-switch">
                        <input type="checkbox" checked={!!showClock} onChange={() => setShowClock(!showClock)} />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>

                    <label className={`island-row compact ${!showClock ? 'disabled' : ''}`}>
                      <div className="row-left">
                        <div className="row-icon icon-seconds">
                          <FiClock size={18} />
                        </div>
                        <div className="row-text">
                          <span className="row-title">{t.showSeconds}</span>
                        </div>
                      </div>
                      <div className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!showSeconds}
                          onChange={() => setShowSeconds(!showSeconds)}
                          disabled={!showClock}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>
                  </div>

                  <div className="island-row-group">
                    <label className="island-row compact">
                      <div className="row-left">
                        <div className="row-icon icon-search">
                          <FiSearch size={18} />
                        </div>
                        <div className="row-text">
                          <span className="row-title">{t.searchBar}</span>
                        </div>
                      </div>
                      <div className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!showSearchBar}
                          onChange={() => setShowSearchBar(!showSearchBar)}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* 快捷方式岛屿 (经常访问/最近访问) */}
                <div className="settings-island">
                  <div className="island-row-group">
                    <label className="island-row compact">
                      <div className="row-left">
                        <div className="row-icon icon-site">
                          <FiGlobe size={18} />
                        </div>
                        <div className="row-text">
                          <span className="row-title">{t.topSites}</span>
                        </div>
                      </div>
                      <div className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!showTopSites}
                          onChange={() => setShowTopSites(!showTopSites)}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>

                    <label className="island-row compact">
                      <div className="row-left">
                        <div className="row-icon icon-clock">
                          <FiClock size={18} />
                        </div>
                        <div className="row-text">
                          <span className="row-title">{t.recentHistory}</span>
                        </div>
                      </div>
                      <div className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!showRecentHistory}
                          onChange={() => setShowRecentHistory(!showRecentHistory)}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>
                  </div>
                </div>
              </section>
            )}

            {activeSection === "layout" && (
              <section className="settings-section" key="layout">
                <h3>{t.contentArea}</h3>

                {/* 最大宽度 + 水平边距 并排 */}
                <div className="settings-island-row">
                  <div className="settings-island settings-island-half">
                    <RangeInput
                      label={
                        <>
                          <FiMaximize size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {t.maxWidth}
                        </>
                      }
                      value={contentMaxWidthDraft}
                      min={LAYOUT_LIMITS.maxWidth.min}
                      max={LAYOUT_LIMITS.maxWidth.max}
                      step={10}
                      onChange={setContentMaxWidthDraft}
                      onCommit={(v) => {
                        commitLayoutCache("layout_contentMaxWidth", v)
                        void setContentMaxWidth(v)
                      }}
                    />
                  </div>

                  <div className="settings-island settings-island-half">
                    <RangeInput
                      label={
                        <>
                          <FiMove size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {t.sidePadding}
                        </>
                      }
                      value={contentPaddingXDraft}
                      min={LAYOUT_LIMITS.paddingX.min}
                      max={LAYOUT_LIMITS.paddingX.max}
                      step={2}
                      onChange={setContentPaddingXDraft}
                      onCommit={(v) => {
                        commitLayoutCache("layout_contentPaddingX", v)
                        void setContentPaddingX(v)
                      }}
                    />
                  </div>
                </div>

                {/* 顶部边距 + 底部边距 并排 */}
                <div className="settings-island-row">
                  <div className="settings-island settings-island-half">
                    <RangeInput
                      label={
                        <>
                          <FiMove size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {t.topPadding}
                        </>
                      }
                      value={contentPaddingTopDraft}
                      min={LAYOUT_LIMITS.paddingTop.min}
                      max={LAYOUT_LIMITS.paddingTop.max}
                      step={2}
                      onChange={setContentPaddingTopDraft}
                      onCommit={(v) => {
                        commitLayoutCache("layout_contentPaddingTop", v)
                        void setContentPaddingTop(v)
                      }}
                    />
                  </div>

                  <div className="settings-island settings-island-half">
                    <RangeInput
                      label={
                        <>
                          <FiMove size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {t.bottomPadding}
                        </>
                      }
                      value={contentPaddingBottomDraft}
                      min={LAYOUT_LIMITS.paddingBottom.min}
                      max={LAYOUT_LIMITS.paddingBottom.max}
                      step={2}
                      onChange={setContentPaddingBottomDraft}
                      onCommit={(v) => {
                        commitLayoutCache("layout_contentPaddingBottom", v)
                        void setContentPaddingBottom(v)
                      }}
                    />
                  </div>
                </div>

                {/* 卡片预览区：直观展示圆角与尺寸调整效果 */}
                <div className="settings-island">
                  <div className="card-preview-layout">
                    <div className="card-preview-left">
                      <span className="card-preview-label">{t.cardPreview}</span>
                      <div
                        className="card-preview-box soft-out"
                        style={{
                          borderRadius: `${iconBorderRadiusDraft}%`,
                          width: `${cardSizeDraft}px`,
                          height: `${cardSizeDraft}px`
                        }}
                      >
                        <div className="card-preview-icon soft-in">
                          <FiGlobe size={cardSizeDraft * 0.3} />
                        </div>
                        <span className="card-preview-title">Site</span>
                      </div>
                    </div>
                    <div className="card-preview-sliders">
                      {/* 图标圆角调整 */}
                      <RangeInput
                        label={
                          <>
                            <FiCircle size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                            {t.iconBorderRadius}
                          </>
                        }
                        value={iconBorderRadiusDraft}
                        min={LAYOUT_LIMITS.iconBorderRadius.min}
                        max={LAYOUT_LIMITS.iconBorderRadius.max}
                        step={1}
                        unit="%"
                        onChange={setIconBorderRadiusDraft}
                        onCommit={(v) => {
                          commitLayoutCache("layout_iconBorderRadius", v)
                          void setIconBorderRadius(v)
                        }}
                      />
                      {/* 卡片尺寸调整 */}
                      <RangeInput
                        label={
                          <>
                            <FiMaximize size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                            {t.cardSize}
                          </>
                        }
                        value={cardSizeDraft}
                        min={LAYOUT_LIMITS.cardSize.min}
                        max={LAYOUT_LIMITS.cardSize.max}
                        step={2}
                        unit="px"
                        onChange={setCardSizeDraft}
                        onCommit={(v) => {
                          commitLayoutCache("layout_cardSize", v)
                          void setCardSize(v)
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeSection === "site" && (
              <section className="settings-section" key="site">
                <h3>{t.siteSettings}</h3>

                {/* 页面元数据预览 (Title & Favicon) */}
                <div className="settings-island">
                  <div className="site-preview-card" style={{ padding: '20px 18px' }}>
                    <div className="site-preview-icon soft-in">
                      {siteFavicon ? (
                        <img src={siteFavicon} alt="Favicon" onError={(e) => (e.currentTarget.style.display = 'none')} />
                      ) : (
                        <FiGlobe size={24} />
                      )}
                    </div>
                    <div className="site-preview-info">
                      <h4>{siteTitle || t.newTab}</h4>
                      <p>{t.previewEffect}</p>
                    </div>
                  </div>
                </div>

                {/* 设置表单：支持失焦自动保存及 Enter 提交 */}
                <div className="settings-island">
                  <div className="settings-field">
                    <label>
                      <FiType size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                      {t.pageTitle}
                    </label>
                    <input
                      type="text"
                      className="settings-input soft-in"
                      placeholder={t.pageTitlePlaceholder}
                      value={siteTitleDraft}
                      onChange={(e) => setSiteTitleDraft(e.target.value)}
                      onBlur={() => setSiteTitle(siteTitleDraft)}
                      onKeyDown={(event) =>
                        handleCommitOnEnter(event, () => setSiteTitle(siteTitleDraft))
                      }
                    />
                  </div>

                  <div className="settings-field">
                    <label>
                      <FiImage size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                      {t.faviconUrl}
                    </label>
                    <input
                      type="text"
                      className="settings-input soft-in"
                      placeholder={t.faviconUrlPlaceholder}
                      value={siteFaviconDraft}
                      onChange={(e) => setSiteFaviconDraft(e.target.value)}
                      onBlur={() => setSiteFavicon(siteFaviconDraft)}
                      onKeyDown={(event) =>
                        handleCommitOnEnter(event, () => setSiteFavicon(siteFaviconDraft))
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {activeSection === "groups" && (
              <section className="settings-section" key="groups">
                <h3>{t.groupManagement}</h3>

                {/* 分组添加区域 */}
                <div className="group-add">
                  <input
                    type="text"
                    className="settings-input soft-in"
                    placeholder={t.newGroupName}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addGroup()
                      }
                    }}
                  />
                  <button type="button" className="settings-btn" onClick={addGroup}>
                    <FiPlus size={16} /> {t.add}
                  </button>
                </div>

                {/* 分组列表：支持排序、快速编辑名称、二次确认删除 */}
                <div className="group-list">
                  {safeGroups.map((group, index) => (
                    <div key={group.id} className="group-row">
                      <div className="group-move">
                        <button
                          type="button"
                          className="icon-btn"
                          disabled={index === 0}
                          onClick={() => moveGroup(index, -1)}
                          aria-label={t.moveUp}>
                          <FiChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          disabled={index === safeGroups.length - 1}
                          onClick={() => moveGroup(index, 1)}
                          aria-label={t.moveDown}>
                          <FiChevronDown size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="settings-input soft-in"
                        value={groupNameDrafts[group.id] ?? group.name}
                        onChange={(e) => updateGroupName(group.id, e.target.value)}
                        onBlur={(e) => commitGroupName(group.id, e.target.value)}
                        onKeyDown={(event) =>
                          handleCommitOnEnter(event, () =>
                            commitGroupName(group.id, event.currentTarget.value)
                          )
                        }
                      />
                      {groupToDelete === group.id ? (
                        <div className="group-confirm-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => executeDeleteGroup(group.id)}
                            aria-label={t.confirmDelete}
                            style={{ color: '#e74c3c' }}
                          >
                            <FiCheck size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn cancel"
                            onClick={cancelDeleteGroup}
                            aria-label={t.cancelDelete}
                          >
                            <FiX size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn delete"
                          onClick={() => confirmDeleteGroup(group.id)}
                          disabled={safeGroups.length <= 1} // 至少保留一个分组
                          aria-label={t.deleteGroup}>
                          <FiTrash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "backup" && (
              <section className="settings-section" key="backup">
                <h3>{t.dataBackup}</h3>

                {/* 导出/导入磁贴 */}
                <div className="backup-grid">
                  <div className="backup-card" onClick={handleExport}>
                    <div className="backup-icon icon-export">
                      <FiDownload size={28} />
                    </div>
                    <div>
                      <h4>{t.exportConfig}</h4>
                      <p>{t.exportConfigDesc}</p>
                    </div>
                  </div>

                  <label className="backup-card">
                    <div className="backup-icon icon-import">
                      <FiUpload size={28} />
                    </div>
                    <div>
                      <h4>{t.importConfig}</h4>
                      <p>{t.importConfigDesc}</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      accept="application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setImportStatus(null)
                          handleImport(file)
                        }
                      }}
                    />
                  </label>
                </div>

                {/* 导入状态反馈 */}
                {importStatus && (
                  <div className={`backup-status ${importStatus.type}`}>
                    {importStatus.type === "success" && <FiCheck size={16} />}
                    {importStatus.message}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
