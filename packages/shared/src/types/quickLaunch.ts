/**
 * 图标展示风格
 * - text: 强制显示文字头像
 * - image: 图片模式（可选自定义图标；未配置时自动匹配内置图标/浏览器 favicon；最终兜底文字）
 */
export type IconStyle = "text" | "image"

/**
 * 快捷启动应用详情接口
 */
export interface QuickLaunchApp {
  /** 唯一标识符 (UUID) */
  id: string
  /** 站点显示名称 */
  name: string
  /** 站点公网/默认 URL */
  url: string
  /** 品牌色/主题色 (十六进制，由 hash 生成或手动指定) */
  color: string
  /** 自定义外部图标的 URL 地址 */
  customIcon?: string
  /** 内网或专用地址 (可选，若存在则在内网环境优先使用) */
  internalUrl?: string

  // -- 图标个性化配置 --
  /** 图标风格模式 */
  iconStyle?: IconStyle
  /** 文字模式下的自定义文字 (建议 1-2 字符) */
  customText?: string
  /** 本地上传图标的 Base64 数据字符串 */
  localIcon?: string

  /**
   * 是否存在本地上传图标
   * @description
   * Base64 图标存储在 extension local storage（key: `icon_${id}`）中，不进入分组数据；
   * 该标记用于在本地图标异步加载前显示占位，避免“闪一下换图”的视觉抖动。
   */
  hasLocalIcon?: boolean
}

/**
 * 快捷启动分组接口
 */
export interface QuickLaunchGroup {
  /** 分组唯一标识符 */
  id: string
  /** 分组显示名称 */
  name: string
  /** 该分组下的应用列表 */
  apps: QuickLaunchApp[]
}
