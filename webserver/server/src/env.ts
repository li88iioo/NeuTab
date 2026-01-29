import fs from "fs"
import path from "path"

function setIfMissing(key: string, value: string) {
  if (process.env[key] != null && process.env[key] !== "") return
  process.env[key] = value
}

function stripQuotes(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

function loadEnvFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false
    const raw = fs.readFileSync(filePath, "utf-8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const idx = trimmed.indexOf("=")
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      const value = stripQuotes(trimmed.slice(idx + 1))
      if (!key) continue
      setIfMissing(key, value)
    }
    return true
  } catch {
    return false
  }
}

// Local dev convenience:
// - running from webserver/: loads ./webserver/.env (cwd/.env)
// - running from webserver/server/: loads ../.env
const candidates = [
  path.join(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "../webserver/.env")
]

for (const p of candidates) {
  if (loadEnvFile(p)) break
}

