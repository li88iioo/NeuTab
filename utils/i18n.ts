/**
 * 支持的语言类型
 */
export type Language = "zh" | "en"

/**
 * 默认语言：中文
 */
export const DEFAULT_LANGUAGE: Language = "zh"

/**
 * 翻译词条接口定义
 * @description 集中管理全站所有 UI 文本，支持多语言扩展。
 */
interface Translations {
  /** 分组为空时的提示 */
  emptyGroupHint: string

  // -- 设置面板相关 --
  settings: string
  personalization: string
  layout: string
  site: string
  groups: string
  backup: string

  // -- 主题与视觉样式 --
  /** 主题前缀词 */
  themePrefix: string
  /** 跟随系统/自动模式 */
  themeAuto: string
  themeLight: string
  themeDark: string
  /** 视觉风格配置项目标题 */
  visualTheme: string
  visualThemeDesc: string
  /** 新拟态风格名称 */
  themeNeumorphic: string
  /** 玻璃拟态/液态风格名称 */
  themeLiquidGlass: string

  // -- 个性化选项 (Appearance) --
  appearanceAndDisplay: string
  darkMode: string
  darkModeDesc: string
  clock: string
  clockDesc: string
  showSeconds: string
  showSecondsDesc: string
  searchBar: string
  searchBarDesc: string
  topSites: string
  topSitesDesc: string
  recentHistory: string
  recentHistoryDesc: string
  language: string
  languageDesc: string
  iconBorderRadius: string
  iconBorderRadiusDesc: string
  cardSize: string
  cardSizeDesc: string
  cardPreview: string

  // -- 布局选项 (Layout) --
  contentArea: string
  maxWidth: string
  sidePadding: string
  topPadding: string
  bottomPadding: string

  // -- 站点配置 (Site) --
  siteSettings: string
  previewEffect: string
  pageTitle: string
  pageTitlePlaceholder: string
  faviconUrl: string
  faviconUrlPlaceholder: string

  // -- 分组管理 (Groups) --
  groupManagement: string
  newGroupName: string
  add: string
  moveUp: string
  moveDown: string
  deleteGroup: string
  confirmDelete: string
  cancelDelete: string

  // -- 备份与恢复 (Backup) --
  dataBackup: string
  exportConfig: string
  exportConfigDesc: string
  importConfig: string
  importConfigDesc: string
  importSuccess: string
  importFailed: string

  // -- 搜索栏 (Search Bar) --
  searchPlaceholder: string
  currentEngine: string
  addCustom: string
  addCustomEngine: string
  editEngine: string
  engineName: string
  engineUrl: string
  onlyHttps: string
  onlyInternal: string
  invalidUrl: string
  bestMatch: string
  added: string

  // -- 快捷启动 (Quick Launch) --
  addShortcut: string
  editShortcut: string
  siteName: string
  siteNamePlaceholder: string
  belongToGroup: string
  iconStyle: string
  iconStyleAuto: string
  iconStyleText: string
  iconStyleImage: string
  customText: string
  iconColor: string
  imageSource: string
  imageUrlPlaceholder: string
  localImageSelected: string
  iconUrlHintInternalFavicon: string
  iconUrlHintDataImage: string
  clearLocalImage: string
  uploadLocalImage: string
  siteUrl: string
  siteUrlPlaceholder: string
  internalUrl: string
  internalUrlOptional: string
  internalUrlPlaceholder: string
  urlRequired: string
  nameRequired: string
  selectImageFile: string
  imageTooLarge: string
  cancel: string
  save: string
  openInNewWindow: string
  openInternalUrl: string
  edit: string
  delete: string
  noRecords: string

  // -- 公共通用 (Common) --
  loading: string
  newTab: string
  default: string
  /** “经常访问”分组名称 */
  frequentlyVisited: string
  /** “最近访问”分组名称 */
  recentlyVisited: string
}

/**
 * 中文翻译包
 */
const zh: Translations = {
  emptyGroupHint: "点击 + 添加快捷方式",
  // Settings Panel
  settings: "设置",
  personalization: "个性化",
  layout: "布局",
  site: "站点",
  groups: "分组",
  backup: "备份",

  // Theme
  themePrefix: "主题",
  themeAuto: "自动",
  themeLight: "浅色",
  themeDark: "深色",
  visualTheme: "视觉主题",
  visualThemeDesc: "选择界面风格",
  themeNeumorphic: "新拟态",
  themeLiquidGlass: "液态玻璃",

  // Personalization Section
  appearanceAndDisplay: "外观与显示",
  darkMode: "深色模式",
  darkModeDesc: "切换日间/夜间主题",
  clock: "时钟",
  clockDesc: "显示首页大时钟",
  showSeconds: "显示秒",
  showSecondsDesc: "时钟精确到秒",
  searchBar: "搜索栏",
  searchBarDesc: "显示中央搜索框",
  topSites: "经常访问",
  topSitesDesc: "显示最常访问的网站",
  recentHistory: "最近访问",
  recentHistoryDesc: "显示最近浏览的历史",
  language: "语言",
  languageDesc: "选择界面语言",
  iconBorderRadius: "卡片圆角",
  iconBorderRadiusDesc: "调节网站卡片的圆角大小",
  cardSize: "卡片大小",
  cardSizeDesc: "调节网站卡片的尺寸",
  cardPreview: "预览",

  // Layout Section
  contentArea: "内容区域",
  maxWidth: "最大宽度",
  sidePadding: "两侧边距",
  topPadding: "顶部边距",
  bottomPadding: "底部边距",

  // Site Section
  siteSettings: "站点设置",
  previewEffect: "预览效果",
  pageTitle: "网页标题",
  pageTitlePlaceholder: "例如: 我的主页",
  faviconUrl: "Favicon 图标地址",
  faviconUrlPlaceholder: "例如: https://example.com/favicon.ico",

  // Groups Section
  groupManagement: "分组管理",
  newGroupName: "新分组名称",
  add: "添加",
  moveUp: "上移",
  moveDown: "下移",
  deleteGroup: "删除分组",
  confirmDelete: "确认删除",
  cancelDelete: "取消删除",

  // Backup Section
  dataBackup: "数据备份",
  exportConfig: "导出配置",
  exportConfigDesc: "将当前设置保存为 JSON 文件",
  importConfig: "导入配置",
  importConfigDesc: "从 JSON 文件恢复设置",
  importSuccess: "导入成功，设置已同步。",
  importFailed: "导入失败，请检查文件格式。",

  // Search Bar
  searchPlaceholder: "搜索网页...",
  currentEngine: "当前",
  addCustom: "添加自定义",
  addCustomEngine: "添加自定义搜索引擎",
  editEngine: "编辑搜索引擎",
  engineName: "引擎名称",
  engineUrl: "搜索 URL",
  onlyHttps: "仅支持 http/https 协议",
  onlyInternal: "仅支持 http/https 或 chrome://、edge://、about: 内部链接",
  invalidUrl: "请输入有效的 URL",
  bestMatch: "最佳匹配",
  added: "已添加",

  // Quick Launch
  addShortcut: "添加快捷方式",
  editShortcut: "编辑快捷方式",
  siteName: "名称",
  siteNamePlaceholder: "例如: GitHub",
  belongToGroup: "分组",
  iconStyle: "图标风格",
  iconStyleAuto: "自动",
  iconStyleText: "文字",
  iconStyleImage: "图片",
  customText: "自定义文字",
  iconColor: "图标颜色",
  imageSource: "图片来源",
  imageUrlPlaceholder: "输入在线图标 URL",
  localImageSelected: "已选择本地图片",
  iconUrlHintInternalFavicon: "检测到浏览器内部 favicon 地址（chrome-extension://.../_favicon/...）：无需手动填写，已自动忽略；图片模式会在运行时自动获取站点图标。",
  iconUrlHintDataImage: "检测到 data:image Base64 图标：请使用右侧“上传本地图片”，避免把大数据写入分组/同步配置。",
  clearLocalImage: "清除本地图片",
  uploadLocalImage: "上传本地图片",
  siteUrl: "网站 URL",
  siteUrlPlaceholder: "例如: github.com",
  internalUrl: "内网地址",
  internalUrlOptional: "可选",
  internalUrlPlaceholder: "例如: http://192.168.1.100:8080",
  urlRequired: "网站 URL 和内网地址至少填写一个",
  nameRequired: "请输入名称",
  selectImageFile: "请选择图片文件（png/jpg/svg 等）",
  imageTooLarge: "图片过大，请选择小于 1MB 的图片",
  cancel: "取消",
  save: "保存",
  openInNewWindow: "新窗口打开",
  openInternalUrl: "打开内网地址",
  edit: "编辑",
  delete: "删除",
  noRecords: "暂无记录",

  // Common
  loading: "加载中",
  newTab: "新标签页",
  default: "默认",
  frequentlyVisited: "经常访问",
  recentlyVisited: "最近访问"
}

/**
 * 英文翻译包
 */
const en: Translations = {
  emptyGroupHint: "Click + to add shortcut",
  // Settings Panel
  settings: "Settings",
  personalization: "Personalization",
  layout: "Layout",
  site: "Site",
  groups: "Groups",
  backup: "Backup",

  // Theme
  themePrefix: "Theme",
  themeAuto: "Auto",
  themeLight: "Light",
  themeDark: "Dark",
  visualTheme: "Visual Theme",
  visualThemeDesc: "Choose interface style",
  themeNeumorphic: "Neumorphic",
  themeLiquidGlass: "Liquid Glass",

  // Personalization Section
  appearanceAndDisplay: "Appearance & Display",
  darkMode: "Dark Mode",
  darkModeDesc: "Toggle light/dark theme",
  clock: "Clock",
  clockDesc: "Show large clock on homepage",
  showSeconds: "Show Seconds",
  showSecondsDesc: "Display seconds in clock",
  searchBar: "Search Bar",
  searchBarDesc: "Show central search box",
  topSites: "Top Sites",
  topSitesDesc: "Show most visited websites",
  recentHistory: "Recent History",
  recentHistoryDesc: "Show recently visited pages",
  language: "Language",
  languageDesc: "Select interface language",
  iconBorderRadius: "Card Radius",
  iconBorderRadiusDesc: "Adjust card corner radius",
  cardSize: "Card Size",
  cardSizeDesc: "Adjust card size",
  cardPreview: "Preview",

  // Layout Section
  contentArea: "Content Area",
  maxWidth: "Max Width",
  sidePadding: "Side Padding",
  topPadding: "Top Padding",
  bottomPadding: "Bottom Padding",

  // Site Section
  siteSettings: "Site Settings",
  previewEffect: "Preview",
  pageTitle: "Page Title",
  pageTitlePlaceholder: "e.g., My Homepage",
  faviconUrl: "Favicon URL",
  faviconUrlPlaceholder: "e.g., https://example.com/favicon.ico",

  // Groups Section
  groupManagement: "Group Management",
  newGroupName: "New group name",
  add: "Add",
  moveUp: "Move Up",
  moveDown: "Move Down",
  deleteGroup: "Delete Group",
  confirmDelete: "Confirm Delete",
  cancelDelete: "Cancel Delete",

  // Backup Section
  dataBackup: "Data Backup",
  exportConfig: "Export Config",
  exportConfigDesc: "Save current settings as JSON file",
  importConfig: "Import Config",
  importConfigDesc: "Restore settings from JSON file",
  importSuccess: "Import successful, settings synced.",
  importFailed: "Import failed, please check file format.",

  // Search Bar
  searchPlaceholder: "Search the web...",
  currentEngine: "Current",
  addCustom: "Add Custom",
  addCustomEngine: "Add Custom Search Engine",
  editEngine: "Edit Search Engine",
  engineName: "Engine Name",
  engineUrl: "Search URL",
  onlyHttps: "Only http/https protocols supported",
  onlyInternal: "Only http/https, chrome://, edge://, and about: URLs are supported",
  invalidUrl: "Please enter a valid URL",
  bestMatch: "Best Match",
  added: "Added",

  // Quick Launch
  addShortcut: "Add Shortcut",
  editShortcut: "Edit Shortcut",
  siteName: "Name",
  siteNamePlaceholder: "e.g., GitHub",
  belongToGroup: "Group",
  iconStyle: "Icon Style",
  iconStyleAuto: "Auto",
  iconStyleText: "Text",
  iconStyleImage: "Image",
  customText: "Custom Text",
  iconColor: "Icon Color",
  imageSource: "Image Source",
  imageUrlPlaceholder: "Enter icon URL",
  localImageSelected: "Local image selected",
  iconUrlHintInternalFavicon: "Detected a browser-internal favicon URL (chrome-extension://.../_favicon/...). You don't need to paste it. It's ignored and the icon will be derived at runtime.",
  iconUrlHintDataImage: "Detected a data:image Base64 icon. Please use “Upload local image” instead to keep group/sync data lightweight.",
  clearLocalImage: "Clear local image",
  uploadLocalImage: "Upload local image",
  siteUrl: "Site URL",
  siteUrlPlaceholder: "e.g., github.com",
  internalUrl: "Internal URL",
  internalUrlOptional: "Optional",
  internalUrlPlaceholder: "e.g., http://192.168.1.100:8080",
  urlRequired: "Site URL or Internal URL is required",
  nameRequired: "Please enter a name",
  selectImageFile: "Please select an image file (png/jpg/svg, etc.)",
  imageTooLarge: "Image is too large. Please choose one smaller than 1MB.",
  cancel: "Cancel",
  save: "Save",
  openInNewWindow: "Open in New Window",
  openInternalUrl: "Open Internal URL",
  edit: "Edit",
  delete: "Delete",
  noRecords: "No records",

  // Common
  loading: "Loading",
  newTab: "New Tab",
  default: "Default",
  frequentlyVisited: "Frequently Visited",
  recentlyVisited: "Recently Visited"
}

/**
 * 语言包映射集
 */
const translations: Record<Language, Translations> = { zh, en }

/**
 * 获取完整的翻译包对象
 * @param lang 目标语言代码
 * @returns 对应的 Translations 翻译包
 */
export const getTranslations = (lang: Language): Translations => {
  return translations[lang] || translations[DEFAULT_LANGUAGE]
}

/**
 * 获取单个翻译词条 (即用即取)
 * @param lang 目标语言代码
 * @param key 翻译键名
 * @returns 翻译后的字符串，若键名不存在则返回键名本身
 */
export const t = (lang: Language, key: keyof Translations): string => {
  return translations[lang]?.[key] || translations[DEFAULT_LANGUAGE][key] || key
}
