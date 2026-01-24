import { useEffect, useMemo, useState } from "react"
import { extractDomain, getInitial, getLetterColor } from "~utils/iconHelper"
import { getBuiltInIconUrl } from "~utils/iconResolver"
import { getBrowserFaviconUrl } from "~utils/favicon"
import { GoogleColorIcon } from "~components/search/icons/GoogleColorIcon"
import LetterAvatar from "./LetterAvatar"
import type { IconStyle } from "~types/quickLaunch"
import "./SmartIcon.css"

/**
 * IconPreview 组件属性
 */
interface IconPreviewProps {
    /** 站点名称 */
    name: string
    /** 站点 URL */
    url: string
    /** 图标渲染风格 */
    iconStyle: IconStyle
    /** 自定义显示的文本 */
    customText?: string
    /** 开发上传的本地图标 */
    localIcon?: string
    /** 自定义外部链接图标 */
    customIcon?: string
    /** 品牌色（用于文本头像背景） */
    color: string
    /** 预览尺寸：normal (32px), large (48px/64px) */
    size?: "normal" | "large"
}

/**
 * 图标实时预览组件
 * @description 
 * 用于 `ShortcutModal` 中的实时视觉反馈。其逻辑与 `SmartIcon` 保持高度同步，
 * 区别在于它直接接收 `formData` 中的原始数据，用于展示“所见即所得”的效果。
 */
const IconPreview = ({
    name,
    url,
    iconStyle,
    customText,
    localIcon,
    customIcon,
    color,
    size = "normal"
}: IconPreviewProps) => {
    const [srcIndex, setSrcIndex] = useState(0)

    // 尺寸配置映射
    const iconSize = size === "large" ? 48 : 32
    const wrapperClass = size === "large" ? "icon-preview-wrapper large" : "icon-preview-wrapper"

    // 注意：Hooks 必须在任何 return 之前调用，否则 iconStyle 切换时会触发
    // "Rendered fewer hooks than expected" 的运行时错误。
    const domain = extractDomain(url)
    const builtInIconUrl = getBuiltInIconUrl({ name, url })
    const faviconUrl = getBrowserFaviconUrl(url, 64)

    const candidates = useMemo(() => {
        // 优先级：上传图标 -> 用户提供的 URL -> 内置图标库 -> 浏览器 favicon
        return [localIcon, customIcon, builtInIconUrl, faviconUrl].filter(Boolean) as string[]
    }, [localIcon, customIcon, builtInIconUrl, faviconUrl])

    useEffect(() => {
        setSrcIndex(0)
    }, [name, url, customIcon, localIcon, builtInIconUrl, faviconUrl, iconStyle])

    const currentSrc = candidates[srcIndex]

    // 模式 1: 文本模式 - 显示自定义文本或首字母
    if (iconStyle === "text") {
        const text = customText?.slice(0, 2) || getInitial(name)
        const textColor = color || getLetterColor(name)
        return <LetterAvatar letter={text} color={textColor} size={size === "large" ? 64 : undefined} />
    }

    // 模式 2: 图片模式（默认）- 镜像 SmartIcon 的探测顺序
    // 1) Google 多彩图标
    if (domain === "google.com") {
        return (
            <div className={wrapperClass}>
                <GoogleColorIcon size={iconSize} />
            </div>
        )
    }

    if (currentSrc) {
        return (
            <div className={wrapperClass}>
                <img
                    src={currentSrc}
                    alt={name}
                    className="preview-image"
                    style={{ width: iconSize, height: iconSize }}
                    loading="lazy"
                    decoding="async"
                    onError={() => setSrcIndex((i) => i + 1)}
                />
            </div>
        )
    }

    // 最终兜底：文字头像
    return <LetterAvatar letter={getInitial(name)} color={color || getLetterColor(name)} size={size === "large" ? 64 : undefined} />
}

export default IconPreview
