/**
 * @file patch-build-html-paths.mjs
 * @description 修正构建产物里的绝对路径资源引用（以 `/` 开头）。
 *
 * 背景：
 * - 桌面 Chrome/Edge 中扩展页面通常运行在 `chrome-extension://<id>/...`，`/xxx.js` 会解析到扩展根目录。
 * - 但部分“支持扩展的移动端浏览器”的 Zip 导入/临时安装机制，可能会让新标签页运行在 file/临时环境，
 *   或者在错误页/隔离环境中把地址栏显示为 `about:blank`。
 * - 此时 HTML 里 `src="/newtab.xxx.js"` / `href="/newtab.xxx.css"` 可能解析到错误的根目录，
 *   最终导致 `ERR_FILE_NOT_FOUND`。
 *
 * 方案：
 * - 将 HTML 中的 `src="/..."` / `href="/..."` 改为 `src="./..."` / `href="./..."`。
 * - 该改动对桌面扩展 URL 同样安全：`chrome-extension://id/./xxx` 仍然有效。
 */

import fs from "node:fs/promises"
import path from "node:path"

const repoRoot = process.cwd()

const exists = async (p) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const patchHtml = async (filePath) => {
  if (!(await exists(filePath))) return false

  const raw = await fs.readFile(filePath, "utf8")
  // 将 src="/..." / href="/..." 改为 src="./..." / href="./..."
  // 注意：不要误伤协议相对地址（例如 //cdn.example.com）。
  const next = raw.replace(/\b(src|href)=(["'])\/(?!\/)/g, "$1=$2./")

  if (next === raw) return false
  await fs.writeFile(filePath, next, "utf8")
  return true
}

const main = async () => {
  const buildDir = path.join(repoRoot, "build")
  if (!(await exists(buildDir))) return

  let changed = false

  // Patch known targets + any future Plasmo targets under build/*/newtab.html.
  const entries = await fs.readdir(buildDir, { withFileTypes: true })
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const html = path.join(buildDir, ent.name, "newtab.html")
    changed ||= await patchHtml(html)
  }

  if (changed) {
    console.log("[patch-build-html-paths] Patched build/*/newtab.html to use relative asset paths.")
  } else {
    console.log("[patch-build-html-paths] No changes needed.")
  }
}

main().catch((e) => {
  console.error("[patch-build-html-paths] Failed:", e)
  process.exitCode = 1
})
