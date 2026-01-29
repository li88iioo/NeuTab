import { memo } from "react"
import Clock from "./Clock"
import "./Header.css"
import type { Language } from "@neutab/shared/utils/i18n"

/**
 * 头部组件属性接口
 */
interface HeaderProps {
  /** 是否启用并显示头部内容（时钟等） */
  enabled?: boolean
  /** 是否显示秒钟 */
  showSeconds: boolean
  /** 当前使用的语言 */
  language: Language
}

/**
 * 页面头部组件
 * @description 主要负责承载时钟等信息展示组件。
 * 为了防止布局抖动（Layout Shift），该组件的状态由父组件通过 Props 传入，不再内部独立订阅 Storage。
 */
const Header = memo(({ enabled = true, showSeconds, language }: HeaderProps) => {
  return (
    <div className="header">
      {/* 仅在启用状态下渲染时钟 */}
      {enabled && <Clock showSeconds={!!showSeconds} showDate={true} language={language} />}
    </div>
  )
})

export default Header
