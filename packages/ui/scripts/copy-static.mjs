import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcRoot = path.join(pkgRoot, "src")
const distRoot = path.join(pkgRoot, "dist")

const copyDir = (from, to, { filter } = {}) => {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name)
    const dstPath = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(srcPath, dstPath, { filter })
    else {
      if (filter && !filter(srcPath)) continue
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

// CSS + assets are needed at runtime because dist JS imports them relatively.
copyDir(path.join(srcRoot, "styles"), path.join(distRoot, "styles"), {
  filter: (p) => p.endsWith(".css")
})
copyDir(path.join(srcRoot, "assets"), path.join(distRoot, "assets"))

// Component-local CSS.
copyDir(path.join(srcRoot, "components"), path.join(distRoot, "components"), {
  filter: (p) => p.endsWith(".css")
})
