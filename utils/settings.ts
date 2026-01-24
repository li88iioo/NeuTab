import type { Language } from "./i18n"

/**
 * 主题颜色模式：跟随系统、浅色、深色
 */
export type ThemeMode = "auto" | "light" | "dark"

/**
 * 视觉风格主题：新拟态、玻璃拟态
 */
export type VisualTheme = "neumorphic" | "liquid-glass"

/**
 * 全局默认配置
 * @description 定义了扩展程序首次运行时或用户重置后的初始状态。
 */
export const DEFAULT_SETTINGS = {
  /** 是否显示大时钟 */
  showClock: true,
  /** 时钟是否显示秒数 */
  showSeconds: false,
  /** 是否显示搜索栏 */
  showSearchBar: true,
  /** 内容区域的最大宽度 (px) */
  contentMaxWidth: 1600,
  /** 两侧内边距 (px) */
  contentPaddingX: 20,
  /** 顶部内边距 (px) */
  contentPaddingTop: 0,
  /** 底部内边距 (px) */
  contentPaddingBottom: 20,
  /** 网页标题 */
  siteTitle: "NeuTab",
  /** 网页 Favicon 图标链接 */
  siteFavicon: "",
  /** 是否显示“经常访问”分组 */
  showTopSites: false,
  /** 是否显示“最近访问”分组 */
  showRecentHistory: false,
  /** 界面语言 */
  language: "zh" as Language,
  /** 颜色主题模式 */
  themeMode: "auto" as ThemeMode,
  /** 视觉风格主题 */
  visualTheme: "neumorphic" as VisualTheme,
  /** 快捷方式图标的圆角百分比 (0-50) */
  iconBorderRadius: 20,
  /** 快捷方式卡片的尺寸 70-130 像素(px) */
  cardSize: 110
}

/**
 * 布局约束限制 (用于 UI 滑块和数据校验)
 */
export const LAYOUT_LIMITS = {
  /** 内容最大宽度范围 */
  maxWidth: { min: 600, max: 1600 },
  /** 横向边距范围 */
  paddingX: { min: 10, max: 120 },
  /** 顶部边距范围 */
  paddingTop: { min: 0, max: 200 },
  /** 底部边距范围 */
  paddingBottom: { min: 0, max: 200 },
  /** 图标圆角百分比范围 (50 为圆形) */
  iconBorderRadius: { min: 0, max: 50 },
  /** 磁贴卡片尺寸范围 (70px最小值确保图标和文字可读性) */
  cardSize: { min: 70, max: 130 }
}

/**
 * 数值约束工具函数
 * @description 确保数值在设定的 [min, max] 范围内，并处理 NaN 情况。
 * @param value 输入值
 * @param min 最小值
 * @param max 最大值
 */
export const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
