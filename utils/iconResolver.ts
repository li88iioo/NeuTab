import { ICON_TITLE_MAP, ICON_URL_MAP } from "~utils/iconUrlMap"
import { extractDomain } from "~utils/iconHelper"

/**
 * 标准化快捷方式名称作为检索键
 * @description 
 * 用户的输入可能包含空格、特殊分隔符（如 | 或 -）或中英文混排。
 * 此函数通过清洗空白符和统一分隔符，使匹配逻辑更具鲁棒性。
 * @param raw 原始名称字符串
 * @returns 规范化后的字符串
 */
export const normalizeTitleKey = (raw: string): string => {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[|·•—–\-_/]+/g, " ")
    .trim()
}

/**
 * 将规范化后的名称拆分为关键词 Token
 * @description 支持 CJK 字符连续匹配和 ASCII 单词匹配。
 * @param normalized 规范化后的名称
 */
const titleTokens = (normalized: string): string[] => {
  return normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []
}

/**
 * 获取内置图标的 URL
 * @description 
 * 采用“隐私优先”的探测策略：
 * 1. 标题匹配：优先通过站点名称匹配图标（例如“Proxmox”）。这可以保护隐私，因为即使是内网 IP，只要名称对上就能显示精美图标。
 * 2. 域名匹配：若标题未命中，则尝试通过公网域名（如 github.com）匹配。
 * 
 * @param params.name 快捷方式名称
 * @param params.url 快捷方式链接
 * @returns 图标资源的相对路径，若未找到则返回 null
 */
export const getBuiltInIconUrl = ({
  name,
  url
}: {
  name: string
  url: string
}): string | null => {
  const normalized = normalizeTitleKey(name)
  if (normalized) {
    // 1.1 全文直接匹配
    const direct = ICON_TITLE_MAP[normalized]
    if (direct) return direct

    // 1.2 分词模糊匹配 (例如 "Synology DSM" 匹配到 "Synology")
    for (const token of titleTokens(normalized)) {
      // 过滤太短的 ASCII 字符（如 "A"），但保留单个中文字符（如 "群"）
      if (token.length < 2 && token.charCodeAt(0) < 0x2e80) continue
      const hit = ICON_TITLE_MAP[token]
      if (hit) return hit
    }
  }

  // 2. 域名解析匹配 (适用于知名公网服务)
  const domain = extractDomain(url)
  if (!domain) return null
  return ICON_URL_MAP[domain] ?? null
}
