import { useEffect, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiCircle, FiGlobe, FiMaximize, FiMove } from "react-icons/fi"
import { DEFAULT_SETTINGS, LAYOUT_LIMITS } from "@neutab/shared/utils/settings"
import type { getTranslations } from "@neutab/shared/utils/i18n"
import { RangeInput } from "@neutab/ui"
import { commitLayoutCache } from "~utils/uiCache"

interface LayoutSectionProps {
  t: ReturnType<typeof getTranslations>
}

/** 布局分区:内容宽度/边距/卡片圆角与尺寸,带 60fps 实时预览 */
const LayoutSection = ({ t }: LayoutSectionProps) => {
  const [contentMaxWidth, setContentMaxWidth, { isLoading: l1 }] = useStorage("contentMaxWidth", DEFAULT_SETTINGS.contentMaxWidth)
  const [contentPaddingX, setContentPaddingX, { isLoading: l2 }] = useStorage("contentPaddingX", DEFAULT_SETTINGS.contentPaddingX)
  const [contentPaddingTop, setContentPaddingTop, { isLoading: l3 }] = useStorage("contentPaddingTop", DEFAULT_SETTINGS.contentPaddingTop)
  const [contentPaddingBottom, setContentPaddingBottom, { isLoading: l4 }] = useStorage("contentPaddingBottom", DEFAULT_SETTINGS.contentPaddingBottom)
  const [iconBorderRadius, setIconBorderRadius, { isLoading: l5 }] = useStorage("iconBorderRadius", DEFAULT_SETTINGS.iconBorderRadius)
  const [cardSize, setCardSize, { isLoading: l6 }] = useStorage("cardSize", DEFAULT_SETTINGS.cardSize)
  const isStorageLoading = l1 || l2 || l3 || l4 || l5 || l6

  // 预览 Draft:滑块拖动时只改 Draft(驱动 CSS 变量),松手才写 Storage
  const [contentMaxWidthDraft, setContentMaxWidthDraft] = useState(contentMaxWidth)
  const [contentPaddingXDraft, setContentPaddingXDraft] = useState(Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingX))
  const [contentPaddingTopDraft, setContentPaddingTopDraft] = useState(contentPaddingTop)
  const [contentPaddingBottomDraft, setContentPaddingBottomDraft] = useState(contentPaddingBottom)
  const [iconBorderRadiusDraft, setIconBorderRadiusDraft] = useState(iconBorderRadius)
  const [cardSizeDraft, setCardSizeDraft] = useState(cardSize)

  /** Storage 值变化(异步加载完成/云同步覆盖)时回填 Draft */
  useEffect(() => {
    if (isStorageLoading) return
    setContentMaxWidthDraft(contentMaxWidth)
    setContentPaddingXDraft(Math.max(LAYOUT_LIMITS.paddingX.min, contentPaddingX))
    setContentPaddingTopDraft(contentPaddingTop)
    setContentPaddingBottomDraft(contentPaddingBottom)
    setIconBorderRadiusDraft(iconBorderRadius)
    setCardSizeDraft(cardSize)
  }, [contentMaxWidth, contentPaddingX, contentPaddingTop, contentPaddingBottom, iconBorderRadius, cardSize, isStorageLoading])

  // Normalize legacy/invalid padding values into the supported range.
  useEffect(() => {
    if (isStorageLoading) return
    if (typeof contentPaddingX !== "number") return
    if (contentPaddingX >= LAYOUT_LIMITS.paddingX.min) return
    const next = LAYOUT_LIMITS.paddingX.min
    setContentPaddingXDraft(next)
    commitLayoutCache("layout_contentPaddingX", next)
    void setContentPaddingX(next)
  }, [contentPaddingX, setContentPaddingX, isStorageLoading])

  /**
   * Effect: 实时视觉预览同步
   * @description Draft 数值实时应用到根元素 CSS 变量:
   * 1. 自动计算 `--card-gap` 和 `--card-scale`。
   * 2. 非线性阴影缩放:大卡片大气、小卡片精致。
   * Storage 未加载完成前跳过,避免用默认值覆盖 NewTab 已按缓存恢复的布局。
   */
  useEffect(() => {
    if (isStorageLoading) return
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

    // Keep live preview in sync with `applyLayoutVariables` behavior (grid-only scaling).
    const padDelta = effectivePaddingX - DEFAULT_SETTINGS.contentPaddingX
    const gridScale = Math.max(0.75, Math.min(1.15, 1 - padDelta / 500))
    const gridSize = Math.round(cardSizeDraft * gridScale * 100) / 100
    root.style.setProperty("--grid-card-size", `${gridSize}px`)
    root.style.setProperty("--grid-card-scale", String(gridSize / 110))
    const gridGap = Math.max(12, Math.round(gridSize * 0.22))
    root.style.setProperty("--grid-card-gap", `${gridGap}px`)

    // 动态阴影计算:非线性缩放避免小卡片"框感"过重
    const shadowScale = Math.pow(cardSizeDraft / 110, 1.3)
    const shadowOffset = Math.max(3, Math.round(8 * shadowScale))
    const shadowBlur = Math.max(6, Math.round(16 * shadowScale))
    const shadowOffsetIn = Math.max(2, Math.round(6 * shadowScale))
    const shadowBlurIn = Math.max(4, Math.round(10 * shadowScale))

    root.style.setProperty("--shadow-offset", `${shadowOffset}px`)
    root.style.setProperty("--shadow-blur", `${shadowBlur}px`)
    root.style.setProperty("--shadow-offset-in", `${shadowOffsetIn}px`)
    root.style.setProperty("--shadow-blur-in", `${shadowBlurIn}px`)
  }, [contentMaxWidthDraft, contentPaddingXDraft, contentPaddingTopDraft, contentPaddingBottomDraft, iconBorderRadiusDraft, cardSizeDraft, isStorageLoading])

  return (
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

      {/* 卡片预览区:直观展示圆角与尺寸调整效果 */}
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
  )
}

export default LayoutSection
