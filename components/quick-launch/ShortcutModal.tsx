import { useEffect, useId, useRef, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiType, FiImage, FiUpload, FiTrash2 } from "react-icons/fi"
import IconPreview from "./IconPreview"
import type { IconStyle } from "~types/quickLaunch"
import { DEFAULT_SETTINGS } from "~utils/settings"
import { getTranslations, type Language } from "~utils/i18n"
import { lockBodyScroll } from "~utils/scrollLock"
import { sanitizeInternalUrl, sanitizeName, sanitizeUrl } from "~utils/validation"

/**
 * ShortcutModal 组件属性
 */
interface ShortcutModalProps {
    /** 模态框标题 */
    title: string
    /** 初始表单数据 */
    initialData: {
        /** 站点名称 */
        name: string
        /** 外部链接 URL */
        url: string
        /** 品牌识别色（用于文字头像背景） */
        color: string
        /** 内部协议链接 (chrome://) */
        internalUrl?: string
        /** 所属分组 ID */
        groupId?: string
        /** 图标渲染风格 */
        iconStyle?: IconStyle
        /** 文本模式下的自定义字符 */
        customText?: string
        /** 本地上传的图标 (Base64) */
        localIcon?: string
        /** 自定义外部图标链接 */
        customIcon?: string
    }
    /** 确认保存回调 */
    onSave: (data: {
        name: string
        url: string
        color: string
        internalUrl?: string
        groupId?: string
        iconStyle?: IconStyle
        customText?: string
        localIcon?: string
        customIcon?: string
    }) => void
    /** 取消/关闭回调 */
    onCancel: () => void
    /** URL 校验错误信息 */
    urlError?: string
    /** 设置错误信息的回调 */
    setUrlError?: (error: string) => void
    /** 可选的分组列表（用于移动分组） */
    groups?: { id: string; name: string }[]
}

/**
 * 快捷方式编辑/新增模态框
 * @description 
 * 用于管理单个快捷启动项。核心功能包括：
 * 1. 实时预览：根据输入动态更新图标显示。
 * 2. 多重链接支持：同时支持普通 Web URL 和浏览器内部协议 (Internal)。
 * 3. 本地上传：支持最大 1MB 的图片上传并自动转化为 Base64 存储以提高离线可用性。
 * 4. 健壮性：内置输入清洗（Sanitize）和 URL 格式修复。
 */
const ShortcutModal = ({
    title,
    initialData,
    onSave,
    onCancel,
    urlError,
    setUrlError,
    groups
}: ShortcutModalProps) => {
    const [language] = useStorage<Language>("language", DEFAULT_SETTINGS.language)
    const t = getTranslations(language || "zh")

    // 交互优化相关 Ref
    const previousFocusRef = useRef<HTMLElement | null>(null)
    const modalRef = useRef<HTMLDivElement | null>(null)
    const nameInputRef = useRef<HTMLInputElement | null>(null)
    const titleId = useId()
    const onCancelRef = useRef(onCancel)

    useEffect(() => {
        onCancelRef.current = onCancel
    }, [onCancel])

    /**
     * Effect: 锁定背景滚动
     * @description 为了沉浸式体验及兼容移动端滚动，模态框开启时应禁用 Body 滚动。
     */
    useEffect(() => {
        previousFocusRef.current = document.activeElement as HTMLElement

        const unlockScroll = lockBodyScroll()

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                onCancelRef.current()
                return
            }

            // Focus trap: keep Tab navigation inside the dialog.
            if (e.key !== "Tab") return
            const root = modalRef.current
            if (!root) return

            const focusables = Array.from(
                root.querySelectorAll<HTMLElement>(
                    [
                        "button:not([disabled])",
                        "input:not([disabled]):not([type='hidden'])",
                        "select:not([disabled])",
                        "textarea:not([disabled])",
                        "[tabindex]:not([tabindex='-1'])"
                    ].join(",")
                )
            ).filter((el) => {
                // Filter out elements that are not actually visible/focusable.
                if (el.getAttribute("aria-hidden") === "true") return false
                if ((el as HTMLInputElement).type === "hidden") return false
                return true
            })

            if (focusables.length === 0) return
            const first = focusables[0]
            const last = focusables[focusables.length - 1]
            const active = document.activeElement as HTMLElement | null

            if (e.shiftKey) {
                if (!active || !root.contains(active) || active === first) {
                    e.preventDefault()
                    last.focus()
                }
            } else {
                if (active === last) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }
        document.addEventListener("keydown", handleKeyDown)

        // 初始聚焦：让键盘用户不需要先 Tab 一圈才能开始输入
        // 但在移动端（触屏设备）不自动聚焦，避免输入法挡住模态框
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
        if (!isTouchDevice) {
            requestAnimationFrame(() => {
                nameInputRef.current?.focus?.()
            })
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown)
            unlockScroll()
            previousFocusRef.current?.focus?.()
        }
    }, [])

    /** 预设品牌识别色列表 */
    const COLORS = [
        "#6c5ce7", // Purple (Default)
        "#0984e3", // Blue
        "#00b894", // Green
        "#e17055", // Orange
        "#d63031", // Red
        "#2d3436", // Dark
    ]

    /** 图标风格选项配置（仅保留 图片/文字） */
    const ICON_STYLES: { value: IconStyle; label: string; icon: React.ReactNode }[] = [
        { value: "image", label: t.iconStyleImage, icon: <FiImage size={14} /> },
        { value: "text", label: t.iconStyleText, icon: <FiType size={14} /> },
    ]

    const isBrowserInternalFaviconUrl = (raw: string) => {
        return (
            (raw.startsWith("chrome-extension://") || raw.startsWith("moz-extension://")) &&
            raw.includes("/_favicon/")
        )
    }

    /** 表单状态 */
    const initialIconStyle: IconStyle = initialData.iconStyle === "text" ? "text" : "image"

    const [formData, setFormData] = useState({
        ...initialData,
        iconStyle: initialIconStyle,
        customText: initialData.customText || "",
        localIcon: initialData.localIcon || "",
        // 不要把运行时 favicon endpoint 或 data:image/* 放进表单（否则用户保存时会遇到“仅支持 http/https”的误报体验）。
        customIcon: (() => {
            const raw = (initialData.customIcon || "").trim()
            if (!raw) return ""
            if (raw.startsWith("data:image/")) return ""
            if (isBrowserInternalFaviconUrl(raw)) return ""
            return raw
        })()
    })
    const [showGroupSelect, setShowGroupSelect] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [iconUrlHint, setIconUrlHint] = useState<null | "internalFavicon" | "dataImage">(null)

    /**
     * 处理表单提交
     * @description 执行数据清洗，校验必填项，并将处理后的数据提交给父组件。
     */
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        try {
            const validatedName = sanitizeName(formData.name)

            if (!validatedName) {
                setUrlError?.(t.nameRequired)
                return
            }

            const rawUrl = formData.url?.trim() ?? ""
            const rawInternal = formData.internalUrl?.trim() ?? ""

            if (!rawUrl && !rawInternal) {
                setUrlError?.(t.urlRequired)
                return
            }

            // 执行 URL 修复（例如补充协议头）
            const validatedUrl = rawUrl ? sanitizeUrl(rawUrl) : ""
            const validatedInternalUrl = rawInternal ? sanitizeInternalUrl(rawInternal) : ""
            const validatedCustomIcon = (() => {
                const raw = formData.customIcon?.trim() ?? ""
                if (!raw) return ""

                // 该字段是“用户提供的图标 URL”（可选项）：
                // - 仅允许 http/https（其它协议一律丢弃）
                // - 不允许持久化浏览器内部 favicon endpoint（会随扩展 ID/环境变化而失效）
                // - 不允许 data:image/*（本地上传统一走 localIcon + 本地存储）
                if (raw.startsWith("data:image/")) return ""
                if (isBrowserInternalFaviconUrl(raw)) return ""
                try {
                    return sanitizeUrl(raw)
                } catch {
                    // 图标 URL 不应阻塞保存；无效就直接忽略
                    return ""
                }
            })()

            onSave({
                ...formData,
                url: validatedUrl,
                internalUrl: validatedInternalUrl,
                name: validatedName,
                customIcon: validatedCustomIcon
            })
        } catch (error) {
            if (error instanceof Error) {
                // Map internal validation messages to localized UI strings.
                if (error.message.includes("Only HTTP/HTTPS")) {
                    setUrlError?.(t.onlyHttps)
                    return
                }
                if (error.message.includes("Only supported URL protocols")) {
                    setUrlError?.(t.onlyInternal)
                    return
                }
                if (error.message.includes("Invalid URL")) {
                    setUrlError?.(t.invalidUrl)
                    return
                }
                if (error.message.includes("URL cannot be empty")) {
                    setUrlError?.(t.urlRequired)
                    return
                }
                setUrlError?.(error.message)
                return
            }
            setUrlError?.(t.invalidUrl)
        }
    }

    /**
     * Prevent accidental submit while typing (mobile keyboards / IME "confirm" often emits Enter).
     * Users can still explicitly save via the Save button.
     */
    const handleFormKeyDown: React.KeyboardEventHandler<HTMLFormElement> = (e) => {
        if (e.key !== "Enter") return
        const target = e.target as HTMLElement | null
        if (!target) return
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA") {
            e.preventDefault()
        }
    }

    /**
     * 处理本地文件上传
     * @description 
     * 将用户选择的图片读取为 DataURL (Base64) 字符串。
     * 为保护 Extension 存储性能，设定了 1MB 的严格限制。
     */
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // 校验文件类型
        if (!file.type.startsWith("image/")) {
            setUrlError?.(t.selectImageFile)
            return
        }

        // 校验文件尺寸 (Base64 编码会带来约 33% 的体积膨胀)
        const MAX_ICON_BYTES = 1024 * 1024 // 1MB
        if (file.size > MAX_ICON_BYTES) {
            setUrlError?.(t.imageTooLarge)
            return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
            const base64 = event.target?.result as string
            // 上传后自动切换至“图片模式”，确保用户能立即看到上传效果
            setFormData({ ...formData, iconStyle: "image", localIcon: base64, customIcon: "" })
            setUrlError?.("")
        }
        reader.readAsDataURL(file)
    }

    return (
        <div className="ql-add-app-modal" onClick={(e) => {
            if (e.target === e.currentTarget) onCancel() // 点击背景关闭
        }}>
            <div
                ref={modalRef}
                className="ql-modal-content soft-out"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <h3 id={titleId}>{title}</h3>

                <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
                    {/* 第一行：实时预览 + 名称/分组设置 */}
                    <div className="ql-modal-top-row">
                        <div className="ql-preview-card soft-in">
                            <IconPreview
                                name={formData.name || "A"}
                                url={formData.url || formData.internalUrl || ""}
                                iconStyle={formData.iconStyle}
                                customText={formData.customText}
                                localIcon={formData.localIcon}
                                customIcon={formData.customIcon}
                                color={formData.color}
                                size="large"
                            />
                            <span className="preview-label">{formData.name || t.previewEffect}</span>
                        </div>

                        <div className="ql-modal-top-fields">
                            <div className="ql-modal-top-field">
                                <span className="ql-inline-label">{t.siteName}</span>
                                <input
                                    ref={nameInputRef}
                                    type="text"
                                    className="ql-modal-input soft-in ql-modal-input-inline"
                                    placeholder={t.siteNamePlaceholder}
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>

                            {/* 分组选择（仅在多分组环境下显示） */}
                            {groups && groups.length > 0 && (
                                <div className="ql-modal-top-field">
                                    <span className="ql-inline-label">{t.belongToGroup}</span>
                                    <div className="ql-select-wrap">
                                        <div
                                            className="ql-custom-select soft-in ql-custom-select-inline"
                                            onClick={() => setShowGroupSelect(!showGroupSelect)}
                                        >
                                            {groups.find(g => g.id === (formData.groupId || groups[0].id))?.name}
                                            <span className="select-arrow">▼</span>
                                        </div>

                                        {showGroupSelect && (
                                            <ul className="ql-select-options soft-out">
                                                {groups.map((group) => (
                                                    <li
                                                        key={group.id}
                                                        className={`ql-option ${group.id === (formData.groupId || groups[0].id) ? 'selected' : ''}`}
                                                        onClick={() => {
                                                            setFormData({ ...formData, groupId: group.id })
                                                            setShowGroupSelect(false)
                                                        }}
                                                    >
                                                        {group.name}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 第二行：图标渲染模式 */}
                    <div className="ql-modal-field">
                        <label>{t.iconStyle}</label>
                        <div className="ql-icon-style-selector">
                            {ICON_STYLES.map((style) => (
                                <button
                                    key={style.value}
                                    type="button"
                                    className={`style-option ${formData.iconStyle === style.value ? "active" : ""}`}
                                    onClick={() => setFormData({ ...formData, iconStyle: style.value })}
                                >
                                    {style.icon}
                                    <span>{style.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 文字模式特有配置：自定义文字 & 品牌背景色 */}
                    {formData.iconStyle === "text" && (
                        <div className="ql-modal-row ql-text-icon-config">
                            <div className="ql-modal-col ql-text-icon-col">
                                <div className="ql-modal-field">
                                    <label>{t.customText}</label>
                                    <input
                                        type="text"
                                        className="ql-modal-input soft-in ql-custom-text-input"
                                        value={formData.customText}
                                        maxLength={2}
                                        onChange={(e) => setFormData({ ...formData, customText: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="ql-modal-col ql-text-color-col">
                                <div className="ql-modal-field">
                                    <label>{t.iconColor}</label>
                                    <div className="ql-color-picker soft-in">
                                        <div className="ql-color-swatches ql-color-swatches-inline">
                                            {COLORS.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    className={`ql-color-circle ${formData.color === color ? "active soft-in" : "soft-out"}`}
                                                    style={{ "--swatch-color": color } as React.CSSProperties}
                                                    onClick={() => setFormData({ ...formData, color })}
                                                >
                                                    <span className="color-dot" style={{ backgroundColor: color }}></span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 图片模式特有配置：链接输入或本地文件上传 */}
                    {formData.iconStyle === "image" && (
                        <div className="ql-modal-field">
                            <label>{t.imageSource}</label>
                            <div className="ql-input-group">
                                <input
                                    type="text"
                                    className="ql-modal-input soft-in"
                                    placeholder={t.imageUrlPlaceholder}
                                    value={formData.localIcon ? t.localImageSelected : formData.customIcon}
                                    disabled={!!formData.localIcon}
                                    onChange={(e) => {
                                        if (formData.localIcon) return
                                        const raw = e.target.value

                                        // UX：用户常会误把浏览器内部 `_favicon` endpoint 粘贴进来；
                                        // 这类 URL 不能持久化（跨环境会失效），也不应触发“仅支持 http/https”的摩擦。
                                        if (isBrowserInternalFaviconUrl(raw.trim())) {
                                            setIconUrlHint("internalFavicon")
                                            setFormData({ ...formData, customIcon: "" })
                                            return
                                        }

                                        // UX：data:image Base64 不是“URL”，应走上传逻辑，避免写入分组/同步数据。
                                        if (raw.trim().startsWith("data:image/")) {
                                            setIconUrlHint("dataImage")
                                            setFormData({ ...formData, customIcon: "" })
                                            return
                                        }

                                        setIconUrlHint(null)
                                        setFormData({ ...formData, customIcon: raw })
                                    }}
                                    style={formData.localIcon ? { fontStyle: "italic", color: "var(--accent)" } : {}}
                                />

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onChange={handleFileUpload}
                                />

                                {formData.localIcon ? (
                                    <button
                                        type="button"
                                        className="ql-icon-action-btn soft-out danger"
                                        onClick={() => setFormData({ ...formData, localIcon: "" })}
                                        title={t.clearLocalImage}
                                    >
                                        <FiTrash2 size={18} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="ql-icon-action-btn soft-out"
                                        onClick={() => fileInputRef.current?.click()}
                                        title={t.uploadLocalImage}
                                    >
                                        <FiUpload size={18} />
                                    </button>
                                )}
                            </div>
                            {iconUrlHint === "internalFavicon" && <div className="url-hint">{t.iconUrlHintInternalFavicon}</div>}
                            {iconUrlHint === "dataImage" && <div className="url-hint">{t.iconUrlHintDataImage}</div>}
                        </div>
                    )}

                    {/* 系统链接输入 */}
                    <div className="ql-modal-field">
                        <label>{t.siteUrl}</label>
                        <input
                            type="text"
                            className="ql-modal-input soft-in"
                            placeholder={t.siteUrlPlaceholder}
                            value={formData.url}
                            onChange={(e) => {
                                setFormData({ ...formData, url: e.target.value })
                                if (setUrlError && urlError) setUrlError("")
                            }}
                        />
                        {urlError && <div className="url-error">{urlError}</div>}
                    </div>

                    {/* 内部链接输入 (可选) */}
                    <div className="ql-modal-field">
                        <label>{t.internalUrl} <span style={{ fontSize: "0.8em", color: "var(--txt-tertiary)", fontWeight: "normal" }}>({t.internalUrlOptional})</span></label>
                        <input
                            type="text"
                            className="ql-modal-input soft-in"
                            placeholder={t.internalUrlPlaceholder}
                            value={formData.internalUrl || ""}
                            onChange={(e) => {
                                setFormData({ ...formData, internalUrl: e.target.value })
                                if (setUrlError && urlError) setUrlError("")
                            }}
                        />
                    </div>

                    <div className="ql-modal-buttons">
                        <button type="button" className="ql-modal-btn cancel soft-out" onClick={onCancel}>
                            {t.cancel}
                        </button>
                        <button type="submit" className="ql-modal-btn save soft-out">
                            {t.save}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default ShortcutModal
