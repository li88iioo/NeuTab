/**
 * @file sync-build-dev.mjs
 * @description 同步编译产物到开发目录。
 * 
 * 动机：
 * 1. Chrome 允许从文件夹加载“已解压的扩展程序”。
 * 2. 开发者通常习惯加载 `build/chrome-mv3-dev` 目录进行调试。
 * 3. 然而，Plasmo 的 `plasmo package` 命令会优先且可靠地更新 `build/chrome-mv3-prod` 目录。
 * 4. 为了避免“我重新打包了，但浏览器里没变化”的困惑，此脚本将 prod 的最新产物镜像同步到 dev 文件夹。
 * 5. 由于新生成的 `newtab.html` 会引用最新的带 Hash 文件名，因此 dev 文件夹中残留的旧文件（stale assets）不会影响运行。
 */

import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const src = path.join(root, "build", "chrome-mv3-prod")
const dst = path.join(root, "build", "chrome-mv3-dev")

if (!fs.existsSync(src)) {
  console.warn(`[sync-build-dev] Missing source folder: ${src}`)
  process.exit(0)
}

// 确保目标目录存在并执行强制同步
fs.mkdirSync(dst, { recursive: true })
fs.cpSync(src, dst, { recursive: true, force: true })

console.log(`[sync-build-dev] Synced ${src} -> ${dst}`)
