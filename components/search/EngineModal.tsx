import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStorage } from "@plasmohq/storage/hook"
import { DEFAULT_SETTINGS } from "~utils/settings"
import { getTranslations, type Language } from "~utils/i18n"

/**
 * EngineModal 组件属性
 */
interface EngineModalProps {
  /** 模态框标题 */
  title: string
  /** 初始表单数据：名称与搜索 URL */
  initialData: { name: string; url: string }
  /** 确认保存回调 */
  onSave: (data: { name: string; url: string }) => void
  /** 取消/关闭回调 */
  onCancel: () => void
  /** URL 校验错误信息 */
  urlError?: string
  /** 设置错误信息的回调 */
  setUrlError?: (error: string) => void
}

/**
 * 搜索引擎编辑/新增模态框
 * @description 用于管理自定义搜索引擎（如私有 SearXNG 或特定文档搜索）。
 */
const EngineModal = ({
  title,
  initialData,
  onSave,
  onCancel,
  urlError,
  setUrlError
}: EngineModalProps) => {
  const [language] = useStorage<Language>("language", DEFAULT_SETTINGS.language)
  const t = getTranslations(language || "zh")

  /** 表单状态管理 */
  const [formData, setFormData] = useState(initialData)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()

  // Render into <body> so `position: fixed` is not affected by any ancestor layout/transform,
  // which can cause the dialog to appear "off-screen" when the page becomes very tall on mobile.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = "hidden"

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
        return
      }

      // Focus trap: keep Tab navigation inside the modal
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
      )

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
      document.body.style.overflow = prevOverflow
      previousFocusRef.current?.focus?.()
    }
  }, [onCancel])

  /**
   * 处理表单提交
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="search-add-engine-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}>
      <div
        ref={modalRef}
        className="search-modal-content soft-out"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>{title}</h3>
        <form onSubmit={handleSubmit}>
          {/* 引擎名称输入 */}
          <input
            ref={nameInputRef}
            type="text"
            className="search-modal-input soft-in"
            placeholder={t.engineName}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          {/* 引擎 URL 模板输入 (支持 %s 占位符) */}
          <input
            type="text"
            className="search-modal-input soft-in"
            placeholder={t.engineUrl}
            value={formData.url}
            onChange={(e) => {
              setFormData({ ...formData, url: e.target.value })
              if (setUrlError) setUrlError("") // 清除历史错误
            }}
          />
          {urlError && <div className="url-error">{urlError}</div>}

          <div className="search-modal-buttons">
            <button type="submit" className="search-modal-btn soft-out">
              {t.save}
            </button>
            <button type="button" className="search-modal-btn soft-out" onClick={onCancel}>
              {t.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

export default EngineModal
