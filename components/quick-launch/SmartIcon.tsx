import { useEffect, useMemo, useState } from "react"
import { extractDomain, getInitial, getLetterColor } from "~utils/iconHelper"
import { getBuiltInIconUrl } from "~utils/iconResolver"
import { getBrowserFaviconUrl } from "~utils/favicon"
import { GoogleColorIcon } from "~components/search/icons/GoogleColorIcon"
import LetterAvatar from "./LetterAvatar"
import type { IconStyle } from "~types/quickLaunch"
import "./SmartIcon.css"

/**
 * SmartIcon 组件属性
 */
interface SmartIconProps {
  /** 应用或站点名称，用于生成字母头像及 Alt 文本 */
  name: string
  /** 目标 URL，用于智能探测站点图标 */
  url: string
  /** 自定义图标 URL */
  customIcon?: string
  /** 兜底背景颜色 */
  fallbackColor?: string
  /** 图标风格：text (纯文本), image (图片模式) */
  iconStyle?: IconStyle
  /** 自定义显示的文本（仅在 text 模式下且非空时有效） */
  customText?: string
  /** 本地缓存的图标数据 (Base64) */
  localIcon?: string
  /**
   * 是否存在本地上传图标（但 localIcon 可能尚未从本地存储异步加载出来）
   * @description 用于避免“先显示内置/字母 -> 片刻后再切换成上传图标”的闪烁。
   */
  hasLocalIcon?: boolean
}

/**
 * 智能图标组件
 * @description 
 * 该组件负责根据多种策略渲染最合适的图标：
 * - text：直接显示文字头像。
 * - image：优先用户上传/自定义 -> 其次内置图标库 -> 再次浏览器 favicon -> 最终兜底文字。
 *
 * 设计要点：
 * - 不把 `chrome-extension://.../_favicon/...` 这种运行时 URL 持久化到配置中（会随扩展 ID 变化而失效）。
 */
const SmartIcon = ({ name, url, customIcon, fallbackColor, iconStyle, customText, localIcon, hasLocalIcon }: SmartIconProps) => {
  // 图片加载失败的“逐级回退”索引，避免一个失败就直接走到字母头像。
  const [srcIndex, setSrcIndex] = useState(0)

  // 兼容旧数据：历史上存在 auto，统一视为 image
  const effectiveStyle: IconStyle = iconStyle === "text" ? "text" : "image"

  // 注意：Hooks 必须在任何 return 之前调用，否则 iconStyle/URL 切换时会触发
  // "Rendered fewer hooks than expected" 的运行时错误。
  const domain = extractDomain(url)
  const builtInIconUrl = getBuiltInIconUrl({ name, url })
  const faviconUrl = getBrowserFaviconUrl(url, 64)

  const candidates = useMemo(() => {
    // 优先级：上传图标 -> 用户提供的 URL -> 内置图标库 -> 浏览器 favicon
    return [localIcon, customIcon, builtInIconUrl, faviconUrl].filter(Boolean) as string[]
  }, [localIcon, customIcon, builtInIconUrl, faviconUrl])

  // 当输入变化（URL/图标来源变化）时，重置回退索引。
  useEffect(() => {
    setSrcIndex(0)
  }, [name, url, customIcon, localIcon, builtInIconUrl, faviconUrl, effectiveStyle])

  // 模式 1: 文本模式 - 显示自定义文本或首字母
  if (effectiveStyle === "text") {
    const text = customText?.slice(0, 2) || getInitial(name)
    const color = fallbackColor || getLetterColor(name)
    return <LetterAvatar letter={text} color={color} />
  }

  // 模式 2: 图片模式（默认）- 按优先级逐级回退
  // 特殊处理：保留内置的多彩 Google 图标
  if (domain === "google.com") {
    return (
      <div className="smart-icon-wrapper">
        <GoogleColorIcon size={32} />
      </div>
    )
  }

  // 若已知存在本地上传图标，但 localIcon 尚未加载出来，则显示占位，避免闪烁。
  if (hasLocalIcon && !localIcon) {
    return (
      <div className="favicon-wrapper" aria-hidden="true">
        <div className="icon-image-placeholder" />
      </div>
    )
  }

  const currentSrc = candidates[srcIndex]
  if (currentSrc) {
    return (
      <div className="favicon-wrapper">
        <img
          src={currentSrc}
          alt={name}
          className="remote-favicon"
          loading="lazy"
          decoding="async"
          onError={() => setSrcIndex((i) => i + 1)}
        />
      </div>
    )
  }

  // 最终兜底：文字头像
  const initial = getInitial(name)
  const color = fallbackColor || getLetterColor(name)

  return <LetterAvatar letter={initial} color={color} />
}

export default SmartIcon
