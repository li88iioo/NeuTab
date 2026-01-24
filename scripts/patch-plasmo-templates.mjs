/**
 * @file patch-plasmo-templates.mjs
 * @description 修正 Plasmo 的 HTML 模板，注入防白闪脚本和移动端优化配置。
 * 
 * 动机：
 * 1. 默认情况下，Plasmo 生成的 HTML 不包含自定义的脚本加载逻辑。
 * 2. 为了在 React 加载前立即恢复主题色，我们需要在 `<head>` 顶部注入 `assets/theme-early-restore.js`。
 * 3. 注入硬编码的背景色 `fallbackStyle`，确保在任何脚本执行前，Body 已经具备了深色背景。
 * 4. 注入 `viewport-fit=cover`，使页面在带刘海屏的移动设备（iOS/Android）上能够利用安全区域显示沉浸式 Header。
 */

import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

/**
 * 通用文件补丁函数
 * @param {string} filePath 文件路径
 * @param {string} needle 唯一标识，用于判断是否已应用补丁（幂等性检查）
 * @param {string} insertAfter 在此字符串之后插入
 * @param {string} insertion 插入的内容
 */
const patchFile = async (filePath, needle, insertAfter, insertion) => {
  if (!existsSync(filePath)) return false

  const raw = await readFile(filePath, "utf8")
  if (raw.includes(needle)) return false // 已打过补丁,跳过

  const idx = raw.indexOf(insertAfter)
  if (idx === -1) {
    // Upstream Plasmo templates can change; keep this script best-effort to avoid breaking installs.
    const msg = `Could not find insertion point in ${filePath}`
    if (process.env.NODE_ENV === 'development') {
      console.error(`[patch-plasmo-templates] ERROR: ${msg}`)
      console.error(`  This may indicate a Plasmo template change. Please review the patch logic.`)
      throw new Error(msg)
    }
    console.warn(`[patch-plasmo-templates] WARNING: ${msg}`)
    return false
  }

  const next = raw.slice(0, idx + insertAfter.length) + insertion + raw.slice(idx + insertAfter.length)
  await writeFile(filePath, next, "utf8")
  return true
}

/**
 * 确保早期主题恢复脚本被注入（并处理旧路径迁移）
 * @param {string} filePath HTML 文件路径
 */
const ensureEarlyRestoreScript = async (filePath) => {
  if (!existsSync(filePath)) return false

  const raw = await readFile(filePath, "utf8")
  const oldTag = `<script src="../theme-early-restore.js"></script>`
  const newTag = `<script src="../assets/theme-early-restore.js"></script>`

  if (raw.includes(newTag)) return false

  // Migration: update the old injected tag path.
  if (raw.includes(oldTag)) {
    const next = raw.replace(oldTag, newTag)
    if (next !== raw) {
      await writeFile(filePath, next, "utf8")
      return true
    }
    return false
  }

  // Fresh install: inject into <head>.
  const insertAfter = `<head>`
  const idx = raw.indexOf(insertAfter)
  if (idx === -1) {
    const msg = `Could not find <head> in ${filePath}`
    if (process.env.NODE_ENV === 'development') {
      console.error(`[patch-plasmo-templates] ERROR: ${msg}`)
      throw new Error(msg)
    }
    console.warn(`[patch-plasmo-templates] WARNING: ${msg}`)
    return false
  }
  const insertion = `\n    ${newTag}`
  const next = raw.slice(0, idx + insertAfter.length) + insertion + raw.slice(idx + insertAfter.length)
  await writeFile(filePath, next, "utf8")
  return true
}

/**
 * 注入移动端刘海屏适配控制
 * @param {string} filePath HTML 文件路径
 */
const patchViewportFitCover = async (filePath) => {
  if (!existsSync(filePath)) return false
  const raw = await readFile(filePath, "utf8")
  if (raw.includes("viewport-fit=cover")) return false

  // 修改现有的 viewport meta 标签，追加 viewport-fit=cover
  const next = raw.replace(
    /(<meta[^>]+name=["']viewport["'][^>]+content=["'])([^"']*)(["'][^>]*>)/i,
    (m, start, content, end) => {
      const trimmed = String(content).trim()
      const updated = trimmed.length ? `${trimmed}, viewport-fit=cover` : "viewport-fit=cover"
      return `${start}${updated}${end}`
    }
  )

  if (next === raw) return false
  await writeFile(filePath, next, "utf8")
  return true
}

/**
 * Ensure the hard fallback style exists and stays in sync with our current palette.
 * If the style tag already exists, update its contents; otherwise, insert it.
 * @param {string} filePath HTML 文件路径
 * @param {string} fallbackStyle 要注入/更新的 <style> 块（包含完整标签）
 * @param {string} insertAfter 插入位置（通常为 <head>）
 * @returns {Promise<boolean>} 是否发生变更
 */
const ensureEarlyFallbackStyle = async (filePath, fallbackStyle, insertAfter) => {
  if (!existsSync(filePath)) return false
  const raw = await readFile(filePath, "utf8")

  const styleRe = /<style id=["']early-theme-fallback-style["']>[\s\S]*?<\/style>/i
  if (styleRe.test(raw)) {
    const next = raw.replace(styleRe, fallbackStyle.trim())
    if (next === raw) return false
    await writeFile(filePath, next, "utf8")
    return true
  }

  // Not present: insert a fresh copy.
  const styleNeedle = `Hard fallback to avoid any initial white flash`
  return patchFile(filePath, styleNeedle, insertAfter, fallbackStyle)
}

/** 主执行函数 */
const main = async () => {
  // 极早期的坚固备份样式：防止在一切脚本/CSS 加载前瞬间的“闪白”
  const fallbackStyle = `\n    <style id="early-theme-fallback-style">\n      /* Hard fallback to avoid any initial white flash before JS/CSS load. */\n      html,\n      body {\n        background-color: #f6f7ff;\n      }\n\n      @media (prefers-color-scheme: dark) {\n        html,\n        body {\n          background-color: #050510;\n        }\n      }\n    </style>`

  const insertAfter = `<head>`

  // 1. 修改 Plasmo 源码中的基础模板。
  // 这样做可以确保后续所有生成的临时页面都自带这些增强配置。
  const template = "node_modules/plasmo/templates/static/react18/index.html"
  let changedTemplate = await ensureEarlyRestoreScript(template)
  changedTemplate ||= await ensureEarlyFallbackStyle(template, fallbackStyle, insertAfter)
  changedTemplate ||= await patchViewportFitCover(template)

  // 2. 修改当前已生成的 .plasmo 临时页面。
  // 确保开发者在不重新安装依赖的情况下，立即看到本地开发效果。
  const plasmoPages = [
    ".plasmo/newtab.html",
    ".plasmo/popup.html",
    ".plasmo/options.html",
    ".plasmo/devtools.html",
    ".plasmo/sidepanel.html"
  ]
  let changedPlasmo = false
  for (const p of plasmoPages) {
    let changed = await ensureEarlyRestoreScript(p)
    changed ||= await ensureEarlyFallbackStyle(p, fallbackStyle, insertAfter)
    changed ||= await patchViewportFitCover(p)
    changedPlasmo ||= changed
  }

  if (changedTemplate || changedPlasmo) {
    console.log("[patch-plasmo-templates] Applied early theme restore injection.")
  } else {
    console.log("[patch-plasmo-templates] No changes needed.")
  }
}

main().catch((e) => {
  console.error("[patch-plasmo-templates] Failed:", e)
  process.exitCode = 1
})
