import "./LetterAvatar.css"

/**
 * LetterAvatar 组件属性
 */
interface LetterAvatarProps {
  /** 显示在头像中的字母或字符 */
  letter: string
  /** 文本颜色（通常对应于站点的品牌色） */
  color?: string
  /** 头像尺寸 (px) */
  size?: number
}

/**
 * 字母头像组件
 * @description 当无法获取站点图标或用户选择显示文本时，生成一个带有首字母的简约头像。
 */
const LetterAvatar = ({ letter, color = "var(--accent)", size }: LetterAvatarProps) => {
  const style: React.CSSProperties = { color }

  // 如果指定了尺寸，则动态计算字体大小（默认比例约为 0.45）
  if (size) {
    style.width = size
    style.height = size
    style.fontSize = size * 0.45
  }

  return (
    <div className="app-icon letter-avatar" style={style}>
      {letter}
    </div>
  )
}

export default LetterAvatar

