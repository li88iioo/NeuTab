/**
 * 网页版存储 API
 * 数据存储在 SQLite 数据库
 */
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import { kvGet, kvGetAll, kvSet, kvSetMany, kvRemove } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router: ExpressRouter = Router()

router.use(authMiddleware)

const MAX_STORAGE_KEYS = (() => {
  const raw = process.env.MAX_SYNC_KEYS
  if (!raw) return 200
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
})()

const MAX_STORAGE_VALUE_BYTES = (() => {
  const raw = process.env.MAX_SYNC_VALUE_BYTES
  if (!raw) return 2 * 1024 * 1024
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 1024 * 1024
})()

const STORAGE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/

function isStorageKeyName(key: string): boolean {
  if (!STORAGE_KEY_RE.test(key)) return false
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false
  return true
}

function valueWithinLimit(value: unknown): boolean {
  try {
    const raw = JSON.stringify(value)
    if (raw === undefined) return false
    return Buffer.byteLength(raw, 'utf8') <= MAX_STORAGE_VALUE_BYTES
  } catch {
    return false
  }
}

// 批量获取 keys
router.post('/getMany', (req: Request, res: Response) => {
  const { keys } = req.body as { keys?: unknown }

  if (!Array.isArray(keys)) {
    return res.status(400).json({ error: 'Missing keys' })
  }
  if (keys.length > MAX_STORAGE_KEYS) {
    return res.status(413).json({ error: 'Too many keys' })
  }

  const items: Record<string, unknown> = Object.create(null)
  const missing: string[] = []

  for (const k of keys) {
    if (typeof k !== 'string' || !isStorageKeyName(k)) {
      return res.status(400).json({ error: `Invalid key: ${String(k)}` })
    }
    const value = kvGet(k)
    if (value === undefined) {
      missing.push(k)
      continue
    }
    items[k] = value
  }

  return res.json({ items, missing })
})

// 获取单个 key
router.get('/get/:key', (req: Request, res: Response) => {
  const { key } = req.params
  if (!isStorageKeyName(key)) {
    return res.status(400).json({ error: 'Invalid key' })
  }

  const value = kvGet(key)
  const found = value !== undefined
  return res.json({ found, value: found ? value : null })
})

// 获取所有数据
router.get('/all', (_req: Request, res: Response) => {
  const data = kvGetAll()
  res.json(data)
})

// 设置单个 key
router.post('/set', (req: Request, res: Response) => {
  const { key, value } = req.body
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing key' })
  }
  if (!isStorageKeyName(key)) {
    return res.status(400).json({ error: 'Invalid key' })
  }
  if (value === undefined) {
    return res.status(400).json({ error: 'Invalid value' })
  }
  if (!valueWithinLimit(value)) {
    return res.status(413).json({ error: 'Value too large or invalid' })
  }

  try {
    kvSet(key, value)
    return res.json({ success: true })
  } catch (e) {
    console.error('[storage] Failed to set:', e)
    return res.status(500).json({ error: 'Failed to set value' })
  }
})

// 批量设置
router.post('/setMany', (req: Request, res: Response) => {
  const { items } = req.body
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    return res.status(400).json({ error: 'Missing items' })
  }

  const entries = Object.entries(items as Record<string, unknown>)
  if (entries.length > MAX_STORAGE_KEYS) {
    return res.status(413).json({ error: 'Too many keys' })
  }

  const toWrite: Record<string, unknown> = Object.create(null)
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || !isStorageKeyName(key)) {
      return res.status(400).json({ error: `Invalid key: ${String(key)}` })
    }
    if (value === undefined) {
      return res.status(400).json({ error: `Invalid value for key: ${key}` })
    }
    if (!valueWithinLimit(value)) {
      return res.status(413).json({ error: `Value too large or invalid for key: ${key}` })
    }
    toWrite[key] = value
  }

  try {
    kvSetMany(toWrite)
    return res.json({ success: true })
  } catch (e) {
    console.error('[storage] Failed to setMany:', e)
    return res.status(500).json({ error: 'Failed to set values' })
  }
})

// 删除 key
router.post('/remove', (req: Request, res: Response) => {
  const { key } = req.body
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing key' })
  }
  if (!isStorageKeyName(key)) {
    return res.status(400).json({ error: 'Invalid key' })
  }

  try {
    kvRemove(key)
    return res.json({ success: true })
  } catch (e) {
    console.error('[storage] Failed to remove:', e)
    return res.status(500).json({ error: 'Failed to remove key' })
  }
})

export default router
