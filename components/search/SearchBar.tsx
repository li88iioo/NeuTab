import { useState, useEffect, useMemo, useRef } from "react"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import { FiArrowRight, FiArrowUpRight, FiPlus, FiTrash2, FiSearch, FiGlobe, FiEdit2, FiGrid } from "react-icons/fi"
import { BingIcon } from "./icons/BingIcon"
import { CustomEngineIcon } from "./icons/CustomEngineIcon"
import { GithubIcon } from "./icons/GithubIcon"
import { GoogleColorIcon } from "./icons/GoogleColorIcon"
import EngineModal from "./EngineModal"
import { DEFAULT_GROUPS } from "~utils/quickLaunchDefaults"
import { DEFAULT_SETTINGS } from "~utils/settings"
import { getTranslations, type Language } from "~utils/i18n"
import { getBrowserFaviconUrl } from "~utils/favicon"
import { logger } from "~utils/logger"
import { ensureChromePermission } from "~utils/permissions"
import type { QuickLaunchGroup, QuickLaunchApp } from "~types/quickLaunch"
import { isAllowedNavigationUrl, isHttpUrl, sanitizeUrl } from "~utils/validation"
import "./SearchBar.css"

/**
 * 搜索引擎配置接口
 */
interface Engine {
  /** 唯一标识符 */
  id: string
  /** 显示名称 */
  name: string
  /** 搜索 URL 模板（查询词将拼接到此 URL 后） */
  url: string
}

/**
 * 搜索结果条目接口
 */
interface SearchResult {
  /** 结果类型：快捷方式或书签 */
  type: "app" | "bookmark"
  /** 对应的数据对象 */
  data: QuickLaunchApp | chrome.bookmarks.BookmarkTreeNode
}

/** 默认预设的搜索引擎列表 */
const DEFAULT_ENGINES: Engine[] = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q=" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=" },
  { id: "github", name: "GitHub", url: "https://github.com/search?q=" }
]

/** 
 * 快捷启动数据存储 
 * 使用 local area (5MB) 以绕过 sync area 的 8KB 限制 
 */
const localGroupsStorage = new Storage({ area: "local" })

const EngineIcon = ({ engine, size = 18 }: { engine: Engine; size?: number }) => {
  switch (engine.id) {
    case "google":
      return <GoogleColorIcon size={size} />
    case "github":
      return <GithubIcon size={size} />
    case "bing":
      return <BingIcon size={size} />
    default: {
      // Privacy-first: custom engines always use a local icon (no remote favicon fetch).
      if (engine.id.startsWith("custom_")) return <CustomEngineIcon size={size} />
      return <FiSearch size={size} color="#999" />
    }
  }
}

/**
 * 搜索框内部实现组件
 * @description 包含核心搜索逻辑、引擎切换、结果聚合（快捷方式 + 浏览器书签）以及引擎管理。
 */
const SearchBarInner = () => {
  // ---------------------------------------------------------------------------
  // 状态与 Hooks
  // ---------------------------------------------------------------------------

  /** 输入框查询文本 */
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  /** 当前语言设置 */
  const [language] = useStorage<Language>("language", DEFAULT_SETTINGS.language)
  const t = getTranslations(language || "zh")

  /** 自定义搜索引擎列表 */
  const [engines, setEngines, { isLoading: isEnginesLoading }] = useStorage<Engine[]>(
    "searchEngines",
    DEFAULT_ENGINES
  )

  /** 存储中的当前引擎 ID */
  const [storedEngineId, setStoredEngineId, { isLoading: isEngineLoading }] = useStorage(
    "currentEngine",
    "google"
  )
  const [openInNewWindow, setOpenInNewWindow] = useStorage(
    "searchOpenInNewWindow",
    DEFAULT_SETTINGS.searchOpenInNewWindow
  )

  /** 
   * 本地状态引擎 ID 
   * @description 用于立即响应 UI 操作，避免 useStorage 异步写入导致的感知延迟。
   */
  const [localEngineId, setLocalEngineId] = useState<string | null>(null)

  // 菜单与弹窗可见性控制
  const [showEngineMenu, setShowEngineMenu] = useState(false)
  const [showAddEngine, setShowAddEngine] = useState(false)
  const [showEditEngine, setShowEditEngine] = useState(false)
  const [editingEngine, setEditingEngine] = useState<Engine | null>(null)
  const [urlError, setUrlError] = useState("")

  const containerRef = useRef<HTMLFormElement>(null)
  const ENGINE_MENU_ID = "engine-menu"

  /**
   * Normalize and validate a search engine URL template.
   * Supports `%s` placeholder without letting `URL(...)` escape it into `%25s`.
   */
  const sanitizeEngineTemplateUrl = (template: string): string => {
    const raw = template.trim()
    if (!raw) throw new Error("URL cannot be empty")

    const marker = "__NEUTAB_QUERY__"
    const withMarker = raw.replace(/%s/g, marker)
    const normalized = sanitizeUrl(withMarker)
    // Restore placeholder for storage / later replacement.
    return normalized.replace(new RegExp(marker, "g"), "%s")
  }

  // ---------------------------------------------------------------------------
  // 副作用处理 (Effects)
  // ---------------------------------------------------------------------------

  /**
   * Effect: 点击外部自动关闭
   * @description 监听全局 mousedown 事件，当点击搜索框外部时关闭引擎切换菜单。
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowEngineMenu(false)
        // 点击外部时也关闭搜索建议
        setSuggestionsOpen(false)
        setActiveSuggestionIndex(-1)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // 键盘：Esc 关闭引擎菜单；打开时自动把焦点移入菜单
  useEffect(() => {
    if (!showEngineMenu) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      setShowEngineMenu(false)
    }
    document.addEventListener("keydown", handleKeyDown)

    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(".engine-menu .engine-icon-btn")
      first?.focus?.()
    })

    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showEngineMenu])

  /** 快捷启动分组数据 */
  const [groups] = useStorage<QuickLaunchGroup[]>(
    { key: "quickLaunchGroups", instance: localGroupsStorage },
    DEFAULT_GROUPS
  )

  /** 聚合后的搜索结果列表 */
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  /** 追踪搜索请求，用于丢弃过时的异步书签搜索结果 */
  const searchRequestRef = useRef(0)

  /**
   * Effect: 搜索过滤逻辑
   * @description 当 query 或分组数据变化时，同时过滤“快捷启动”和“浏览器书签”。
   * 书签搜索包含 150ms 防抖处理。
   */
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([])
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
      return
    }

    const q = query.toLowerCase()
    // 用户开始输入时默认展开建议
    setSuggestionsOpen(true)

    // 1. 过滤快捷启动应用
    const appMatches: SearchResult[] = []
    if (groups) {
      groups.forEach(g => {
        if (!g.apps) return
        g.apps.forEach(app => {
          const internal = (app.internalUrl ?? "").toLowerCase()
          if (app.name.toLowerCase().includes(q) || app.url.toLowerCase().includes(q) || internal.includes(q)) {
            appMatches.push({ type: 'app', data: app })
          }
        })
      })
    }

    // 2. 调用 Chrome API 过滤浏览器书签 (支持防抖)
    const chromeApi = typeof chrome === "undefined" ? undefined : chrome
    if (chromeApi?.bookmarks?.search) {
      const requestId = ++searchRequestRef.current
      const timer = setTimeout(() => {
        const runSearch = () => {
          chromeApi.bookmarks.search(query, (results) => {
            // 仅处理最新的请求结果，防止竞态条件
            if (searchRequestRef.current !== requestId) return
            if (chromeApi.runtime?.lastError) {
              logger.warn("[bookmarks] Failed:", chromeApi.runtime.lastError.message)
              setSearchResults(appMatches)
              return
            }
            const bookmarkMatches: SearchResult[] = results
              // Filter out bookmarklets / non-web schemes (e.g. `javascript:`).
              .filter((b) => b.url && isHttpUrl(b.url))
              .slice(0, 50)
              .map(b => ({ type: 'bookmark', data: b }))

            // 合并：常用 App 在前，书签在后
            setSearchResults([...appMatches, ...bookmarkMatches].slice(0, 50))
          })
        }

        const runWithPermission = async () => {
          const granted = await ensureChromePermission(chromeApi, "bookmarks")
          if (searchRequestRef.current !== requestId) return
          if (!granted) {
            setSearchResults(appMatches)
            return
          }
          runSearch()
        }
        void runWithPermission()
      }, 150)
      return () => clearTimeout(timer)
    } else {
      // 环境不支持书签 API 时仅显示 App 匹配项
      setSearchResults(appMatches)
    }
  }, [query, groups])

  // 当结果集合变化时，重置高亮项，避免“高亮索引越界”
  useEffect(() => {
    setActiveSuggestionIndex(-1)
  }, [query, searchResults.length])

  // 高亮项变化时，尽量保持其可见（键盘上下选择不会“滚到看不见”）
  useEffect(() => {
    if (activeSuggestionIndex < 0) return
    const el = document.getElementById(`suggestion_${activeSuggestionIndex}`)
    el?.scrollIntoView?.({ block: "nearest" })
  }, [activeSuggestionIndex])

  /**
   * Effect: 状态同步
   * @description 当 Storage 值加载完成时，将其同步到本地瞬时状态。
   */
  useEffect(() => {
    if (isEngineLoading) return
    setLocalEngineId(storedEngineId || "google")
  }, [storedEngineId, isEngineLoading])

  // ---------------------------------------------------------------------------
  // 核心逻辑与计算值
  // ---------------------------------------------------------------------------

  /** 优先使用本地瞬时 ID，增强交互顺滑度 */
  const currentEngineId = localEngineId ?? storedEngineId ?? "google"
  const openInNewWindowEnabled = !!openInNewWindow

  /** 防御性检查：确保引擎数组有效，否则回退到默认 */
  const safeEngines = engines?.length > 0 ? engines : DEFAULT_ENGINES
  const currentEngine = safeEngines.find((e) => e.id === currentEngineId) || safeEngines[0]
  const isLoading = isEnginesLoading || isEngineLoading

  /** 执行搜索跳转 */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    try {
      // Normalize and validate engine URL template (http/https only).
      const template = sanitizeEngineTemplateUrl(currentEngine.url)
      const encoded = encodeURIComponent(q)
      const href = template.includes("%s") ? template.replace(/%s/g, encoded) : template + encoded
      if (openInNewWindowEnabled) {
        window.open(href, "_blank", "noopener,noreferrer")
      } else {
        window.location.assign(href)
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Only HTTP/HTTPS")) {
        setUrlError(t.onlyHttps)
      } else {
        setUrlError(t.invalidUrl)
      }
    }
  }

  const openSuggestion = (url: string) => {
    if (!url) return
    if (!isAllowedNavigationUrl(url)) return
    window.location.href = url
  }

  const suggestions = useMemo(() => {
    if (!searchResults.length) return []

    return searchResults.map((item) => {
      const data = item.data
      const isApp = item.type === "app"
      const url = isApp
        ? ((data as QuickLaunchApp).url || (data as QuickLaunchApp).internalUrl || "")
        : (data as chrome.bookmarks.BookmarkTreeNode).url || ""
      const name = isApp ? (data as QuickLaunchApp).name : (data as chrome.bookmarks.BookmarkTreeNode).title
      const id = isApp ? (data as QuickLaunchApp).id : (data as chrome.bookmarks.BookmarkTreeNode).id

      const hostname = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "")
        } catch {
          return url
        }
      })()

      let iconUrl: string | null = null

      if (isApp) {
        const appData = data as QuickLaunchApp
        // 优先级：自定义图标 URL (非 Base64/Data URI) > Favicon
        if (appData.customIcon && !appData.customIcon.startsWith("data:")) {
          iconUrl = appData.customIcon
        }
      }

      if (!iconUrl) {
        // 如果是书签或 App 未设置自定义图标，从浏览器获取 favicon
        iconUrl = getBrowserFaviconUrl(url, 32)
      }

      return {
        key: `${item.type}_${id}`,
        url,
        name,
        hostname,
        iconUrl,
        isApp
      }
    })
  }, [searchResults])

  const suggestionsVisible = suggestionsOpen && !!query.trim() && suggestions.length > 0

  const handleInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!suggestionsVisible) return

    if (e.key === "Escape") {
      e.preventDefault()
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveSuggestionIndex((prev) => Math.min(suggestions.length - 1, Math.max(0, prev + 1)))
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveSuggestionIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1))
      return
    }

    if (e.key === "Enter" && activeSuggestionIndex >= 0) {
      const item = suggestions[activeSuggestionIndex]
      const url = item?.url || ""
      if (url) {
        e.preventDefault()
        openSuggestion(url)
      }
    }
  }

  /** 切换当前搜索引擎 */
  const switchEngine = (engine: Engine) => {
    setLocalEngineId(engine.id)
    setStoredEngineId(engine.id)
    setShowEngineMenu(false)
  }

  /** 验证 URL 合法性 */
  const validateUrl = (url: string): boolean => {
    try {
      void sanitizeEngineTemplateUrl(url)
      setUrlError("")
      return true
    } catch (e) {
      if (e instanceof Error && e.message.includes("Only HTTP/HTTPS")) {
        setUrlError(t.onlyHttps)
        return false
      }
      setUrlError(t.invalidUrl)
      return false
    }
  }

  /** 删除自定义引擎 */
  const deleteEngine = (engineId: string) => {
    const updated = safeEngines.filter((e) => e.id !== engineId)
    setEngines(updated.length > 0 ? updated : DEFAULT_ENGINES)
    // 如果删除的是当前正在使用的，则切换到第一个
    if (currentEngineId === engineId && updated.length > 0) {
      setLocalEngineId(updated[0].id)
      setStoredEngineId(updated[0].id)
    }
  }

  /** 打开引擎编辑弹窗 */
  const openEditEngine = (engine: Engine) => {
    setEditingEngine(engine)
    setShowEditEngine(true)
    setShowEngineMenu(false)
    setUrlError("")
  }

  /** 渲染引擎图标 */
  if (isLoading) return null

  return (
    <div className="search-container">
      <form
        ref={containerRef}
        onSubmit={handleSearch}
        className="search-form soft-in"
      >
        {/* 搜索引擎切换按钮 */}
        <button
          type="button"
          className="engine-icon"
          onClick={() => setShowEngineMenu(!showEngineMenu)}
          aria-haspopup="menu"
          aria-expanded={showEngineMenu}
          aria-controls={ENGINE_MENU_ID}
          title={`${t.currentEngine}: ${currentEngine.name}`}>
          <EngineIcon engine={currentEngine} />
        </button>

        {/* 引擎下拉菜单 */}
        {showEngineMenu && (
          <div className="engine-menu soft-out" id={ENGINE_MENU_ID} role="menu" aria-label={t.currentEngine}>
            <div className="engine-menu-scroll" role="group" aria-label={t.currentEngine}>
              <div className="engine-menu-row">
                <div className={`engine-icon-item ${openInNewWindowEnabled ? "active" : ""}`}>
                  <button
                    type="button"
                    className={`engine-icon-btn engine-toggle-btn soft-out ${openInNewWindowEnabled ? "active" : ""}`}
                    aria-pressed={openInNewWindowEnabled}
                    aria-label={t.searchOpenInNewWindow}
                    title={t.searchOpenInNewWindow}
                    onClick={() => setOpenInNewWindow(!openInNewWindowEnabled)}
                  >
                    <FiArrowUpRight size={16} />
                  </button>
                </div>
                {safeEngines.map((engine) => {
                  const isActive = engine.id === currentEngineId
                  const isCustom = engine.id.startsWith("custom_")
                  return (
                    <div
                      key={engine.id}
                      className={`engine-icon-item ${isActive ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="engine-icon-btn soft-out"
                        role="menuitemradio"
                        aria-checked={isActive}
                        aria-label={engine.name}
                        title={engine.name}
                        onClick={() => switchEngine(engine)}
                      >
                        <EngineIcon engine={engine} />
                      </button>
                      {isCustom && (
                        <div className="engine-icon-actions">
                          <button
                            type="button"
                            className="engine-icon-action"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditEngine(engine)
                            }}
                            aria-label={t.edit}
                            title={t.edit}>
                            <FiEdit2 size={12} />
                          </button>
                          <button
                            type="button"
                            className="engine-icon-action delete"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteEngine(engine.id)
                            }}
                            aria-label={t.delete}
                            title={t.delete}>
                            <FiTrash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="engine-icon-btn engine-icon-add soft-out"
                  onClick={() => {
                    setShowEngineMenu(false)
                    setShowAddEngine(true)
                  }}
                  aria-label={t.addCustom}
                  title={t.addCustom}
                  role="menuitem">
                  <FiPlus size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onFocus={() => {
            if (query.trim()) setSuggestionsOpen(true)
          }}
        />

        <button type="submit" className="search-btn soft-out" aria-label={t.searchBar}>
          <FiArrowRight size={18} />
        </button>

        {/* 搜索建议列表：包含聚合后的应用和书签结果 */}
        {suggestionsVisible && (
          <div className="search-suggestions soft-out" role="listbox" aria-label={t.bestMatch}>
            <div className="suggestion-header">
              <FiSearch size={12} color="var(--accent)" /> {t.bestMatch}
            </div>
            {suggestions.map((item, index) => {
              return (
                <button
                  key={item.key}
                  className="suggestion-item"
                  id={`suggestion_${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  onMouseDown={(e) => {
                    e.preventDefault() // 防止点击时输入框失去焦点导致列表消失
                    openSuggestion(item.url)
                  }}
                >
                  <div className="suggestion-left">
                    {item.iconUrl ? (
                      <img
                        src={item.iconUrl}
                        alt=""
                        className="suggestion-favicon"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    ) : (
                      item.isApp ? <FiGrid size={16} className="suggestion-fallback-icon" /> : <FiGlobe size={16} className="suggestion-fallback-icon" />
                    )}
                    <span className="suggestion-title">
                      {item.name}
                      {item.isApp && <span style={{ fontSize: '0.7em', color: 'var(--accent)', marginLeft: '4px' }}>• {t.added}</span>}
                    </span>
                  </div>
                  <span className="suggestion-url">{item.hostname}</span>
                </button>
              )
            })}
          </div>
        )}
      </form>

      {/* 引擎管理模态框 */}
      {showAddEngine && (
        <EngineModal
          title={t.addCustomEngine}
          initialData={{ name: "", url: "" }}
          onSave={(data) => {
            if (data.name && data.url) {
              if (!validateUrl(data.url)) return
              const normalizedUrl = sanitizeEngineTemplateUrl(data.url)
              const customEngine: Engine = {
                id: "custom_" + Date.now(),
                name: data.name,
                url: normalizedUrl
              }
              setEngines([...safeEngines, customEngine])
              setShowAddEngine(false)
              setUrlError("")
            }
          }}
          onCancel={() => {
            setShowAddEngine(false)
            setUrlError("")
          }}
          urlError={urlError}
          setUrlError={setUrlError}
        />
      )}

      {showEditEngine && editingEngine && (
        <EngineModal
          title={t.editEngine}
          initialData={{ name: editingEngine.name, url: editingEngine.url }}
          onSave={(data) => {
            if (data.name && data.url) {
              if (!validateUrl(data.url)) return
              const normalizedUrl = sanitizeEngineTemplateUrl(data.url)
              const updatedEngines = safeEngines.map((eng) =>
                eng.id === editingEngine.id
                  ? { ...eng, name: data.name, url: normalizedUrl }
                  : eng
              )
              setEngines(updatedEngines)
              setShowEditEngine(false)
              setEditingEngine(null)
              setUrlError("")
            }
          }}
          onCancel={() => {
            setShowEditEngine(false)
            setEditingEngine(null)
            setUrlError("")
          }}
          urlError={urlError}
          setUrlError={setUrlError}
        />
      )}
    </div>
  )
}

/**
 * 搜索引擎组件入口
 * @description 暴露给外部的包裹组件，支持按需禁用显示。
 * @param {boolean} enabled - 是否启用并渲染搜索条，默认 true。
 */
const SearchBar = ({ enabled = true }: { enabled?: boolean }) => {
  // 当禁用时，仅保留容器高度以防止布局坍塌，但不运行任何内部逻辑/Hooks。
  if (!enabled) {
    return (
      <div className="search-container" aria-hidden="true">
        <div className="search-form soft-in search-form--placeholder" />
      </div>
    )
  }

  return <SearchBarInner />
}

export default SearchBar
