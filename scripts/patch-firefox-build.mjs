/**
 * @file patch-firefox-build.mjs
 * @description 修正 Firefox 编译产物，使其符合 Firefox 插件安装规范。
 * 
 * 动机：
 * 1. Chrome 的 `favicon` 权限和 `/_favicon/` 接口是 Chromium 特有的。
 *    如果在 Firefox 的清单中保留此权限，会导致安装错误。
 * 2. `topSites` 在不同浏览器间的表现不一致，Firefox 版通常需要更保守的权限基线。
 * 3. 确保包含必要的 `browser_specific_settings` (ID 和最低版本)，以便于提交商店或本地调试。
 */

import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const PATCHED_TARGET_DIRS = ["build/firefox-mv3-prod", "build/firefox-mv3-dev"]

/**
 * 清理不支持的权限
 * @param {string[]} permissions 权限列表
 */
const patchPermissions = (permissions) => {
  if (!Array.isArray(permissions)) return permissions
  // 移除 Firefox 不支持或会导致错误的权限
  const deny = new Set(["favicon", "topSites"])
  return permissions.filter((p) => !deny.has(p))
}

/**
 * 注入 Gecko 专用配置
 * @description 为 Firefox 提交/签名提供固定的 ID。
 * @param {object} manifest 清单对象
 */
const ensureGeckoSettings = (manifest) => {
  // ID 来源：环境变量或本地默认占位符
  const id = process.env.FIREFOX_EXTENSION_ID || "neutab@local"
  const strictMinVersion = process.env.FIREFOX_MIN_VERSION || "109.0"

  manifest.browser_specific_settings ||= {}
  manifest.browser_specific_settings.gecko ||= {}
  manifest.browser_specific_settings.gecko.id ||= id
  manifest.browser_specific_settings.gecko.strict_min_version ||= strictMinVersion
}

/**
 * 处理单个清单文件
 * @param {string} manifestPath 文件路径
 */
const patchManifestFile = async (manifestPath) => {
  if (!existsSync(manifestPath)) return false
  const raw = await readFile(manifestPath, "utf8")
  const manifest = JSON.parse(raw)

  manifest.permissions = patchPermissions(manifest.permissions)
  ensureGeckoSettings(manifest)

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  return true
}

/** 主控制逻辑 */
const main = async () => {
  let changed = false

  // 1. 修正最终编译输出目录（用于分发/安装的产物）
  for (const dir of PATCHED_TARGET_DIRS) {
    const p = resolve(dir, "manifest.json")
    changed ||= await patchManifestFile(p)
  }

  // 2. 修正 Plasmo 自动生成的中间清单（用于开发阶段调试）
  const plasmoManifest = resolve(".plasmo/firefox-mv3.plasmo.manifest.json")
  if (existsSync(plasmoManifest)) {
    changed ||= await patchManifestFile(plasmoManifest)
  }

  if (changed) {
    console.log("[patch-firefox-build] Patched Firefox manifest(s).")
  } else {
    console.log("[patch-firefox-build] No Firefox manifest found to patch.")
  }
}

main().catch((e) => {
  console.error("[patch-firefox-build] Failed:", e)
  process.exitCode = 1
})

