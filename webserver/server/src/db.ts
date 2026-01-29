/**
 * SQLite 数据库初始化 + 预编译语句
 * 替代原有的 storage.json 文件存储
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR = (() => {
  const raw = process.env.DATA_DIR
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  }
  // Default:
  // - dev (tsx): webserver/server/data
  // - prod (dist in /app/dist): /app/data (works with docker-compose volume)
  return path.join(__dirname, '../data')
})()

const ICONS_DIR = path.join(DATA_DIR, 'icons')

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true })
}

// 初始化数据库
const dbPath = path.join(DATA_DIR, 'neutab.db')
const db: DatabaseType = new Database(dbPath)

// 启用 WAL 模式
db.pragma('journal_mode = WAL')
// Avoid SQLITE_BUSY under bursty concurrent requests.
db.pragma('busy_timeout = 5000')

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS icons (
    id         TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,
    mime_type  TEXT DEFAULT 'image/png',
    size_bytes INTEGER DEFAULT 0,
    hash       TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`)

function ensureIconsSchema(): void {
  const cols = db.prepare('PRAGMA table_info(icons)').all() as Array<{ name: string }>
  const hasHash = cols.some((c) => c.name === 'hash')
  if (!hasHash) {
    db.exec('ALTER TABLE icons ADD COLUMN hash TEXT')
  }
}

ensureIconsSchema()

// 预编译语句
const statements = {
  kvGet: db.prepare('SELECT value FROM kv_store WHERE key = ?'),
  kvGetAll: db.prepare('SELECT key, value FROM kv_store'),
  kvSet: db.prepare(`
    INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `),
  kvRemove: db.prepare('DELETE FROM kv_store WHERE key = ?'),

  iconGet: db.prepare('SELECT * FROM icons WHERE id = ?'),
  iconGetAll: db.prepare('SELECT * FROM icons'),
  iconSet: db.prepare(`
    INSERT INTO icons (id, filename, mime_type, size_bytes, hash, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      filename = excluded.filename,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      hash = excluded.hash
  `),
  iconRemove: db.prepare('DELETE FROM icons WHERE id = ?'),
  iconCountByFilename: db.prepare('SELECT COUNT(*) as cnt FROM icons WHERE filename = ?'),
}

// KV 存储操作
export function kvGet(key: string): unknown {
  const row = statements.kvGet.get(key) as { value: string } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.value)
  } catch {
    return row.value
  }
}

export function kvGetAll(): Record<string, unknown> {
  const rows = statements.kvGetAll.all() as { key: string; value: string }[]
  // Use a null-prototype object to avoid prototype-pollution edge cases
  // when callers serialize the whole object.
  const result: Record<string, unknown> = Object.create(null)
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value)
    } catch {
      result[row.key] = row.value
    }
  }
  return result
}

function stringifyKvValue(value: unknown): string {
  const str = JSON.stringify(value)
  // JSON.stringify(undefined) returns undefined (not a string), which would violate the NOT NULL constraint.
  if (str === undefined) {
    throw new Error("Invalid kv value: undefined")
  }
  return str
}

export function kvSet(key: string, value: unknown): void {
  statements.kvSet.run(key, stringifyKvValue(value))
}

export function kvSetMany(items: Record<string, unknown>): void {
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(items)) {
      statements.kvSet.run(key, stringifyKvValue(value))
    }
  })
  transaction()
}

export function kvRemove(key: string): void {
  statements.kvRemove.run(key)
}

// 图标存储操作
export interface IconMeta {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  hash: string | null
  created_at: number
}

export function iconGet(id: string): IconMeta | undefined {
  return statements.iconGet.get(id) as IconMeta | undefined
}

export function iconGetAll(): IconMeta[] {
  return statements.iconGetAll.all() as IconMeta[]
}

export function iconSet(id: string, filename: string, mimeType: string, sizeBytes: number, hash: string | null): void {
  statements.iconSet.run(id, filename, mimeType, sizeBytes, hash)
}

export function iconRemove(id: string): void {
  statements.iconRemove.run(id)
}

export function iconCountByFilename(filename: string): number {
  const row = statements.iconCountByFilename.get(filename) as { cnt: number } | undefined
  return row?.cnt ?? 0
}

// 图标文件路径
export function getIconPath(filename: string): string {
  const base = path.resolve(ICONS_DIR)
  const full = path.resolve(ICONS_DIR, filename)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('Invalid icon path')
  }
  return full
}

export function getIconsDir(): string {
  return ICONS_DIR
}

// JSON → SQLite 迁移
function migrateFromJson(): void {
  const jsonPath = path.join(DATA_DIR, 'storage.json')
  if (!fs.existsSync(jsonPath)) return

  // 检查 kv_store 是否为空
  const count = db.prepare('SELECT COUNT(*) as cnt FROM kv_store').get() as { cnt: number }
  if (count.cnt > 0) {
    console.log('[Migration] kv_store not empty, skipping migration')
    return
  }

  console.log('[Migration] Starting JSON → SQLite migration...')

  try {
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

    const transaction = db.transaction(() => {
      for (const [key, value] of Object.entries(jsonData)) {
        // icon_* keys → 文件 + icons 表
        if (key.startsWith('icon_') && typeof value === 'string' && value.startsWith('data:image/')) {
          const appId = key.slice(5) // remove "icon_" prefix
          const match = value.match(/^data:image\/(\w+);base64,(.+)$/)
          if (match) {
            const [, ext, base64Data] = match
            const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
            const mimeType = `image/${ext}`
            const buffer = Buffer.from(base64Data, 'base64')
            const hash = crypto.createHash('sha256').update(buffer).digest('hex')
            const filename = `${hash}.${normalizedExt}`
            const filePath = getIconPath(filename)

            if (!fs.existsSync(filePath)) {
              fs.writeFileSync(filePath, buffer)
            }
            statements.iconSet.run(appId, filename, mimeType, buffer.length, hash)
            console.log(`[Migration] Migrated icon: ${appId}`)
          }
        } else {
          // 其他数据 → kv_store
          statements.kvSet.run(key, JSON.stringify(value))
        }
      }
    })

    transaction()

    // 重命名旧文件
    fs.renameSync(jsonPath, jsonPath + '.migrated')
    console.log('[Migration] Completed. Old file renamed to storage.json.migrated')
  } catch (e) {
    console.error('[Migration] Failed:', e)
  }
}

function migrateExistingIconFiles(): void {
  try {
    const rows = iconGetAll()
    for (const row of rows) {
      if (row.hash && row.filename.startsWith(row.hash)) continue

      let filePath: string
      try {
        filePath = getIconPath(row.filename)
      } catch {
        continue
      }
      if (!fs.existsSync(filePath)) continue

      const buffer = fs.readFileSync(filePath)
      const hash = crypto.createHash('sha256').update(buffer).digest('hex')
      const ext = path.extname(row.filename).slice(1) || 'png'
      const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
      const newFilename = `${hash}.${normalizedExt}`
      const newPath = getIconPath(newFilename)

      if (newFilename !== row.filename) {
        if (fs.existsSync(newPath)) {
          // Blob already exists (dedupe) - remove old file.
          try {
            fs.unlinkSync(filePath)
          } catch {
            // ignore
          }
        } else {
          fs.renameSync(filePath, newPath)
        }
      }

      iconSet(row.id, newFilename, row.mime_type, buffer.length, hash)
    }
  } catch (e) {
    console.warn('[Migration] Failed to migrate existing icon files:', e)
  }
}

// 执行迁移
migrateFromJson()
migrateExistingIconFiles()

export { db, DATA_DIR }
