/**
 * 同步 API - 插件版推送/拉取
 * POST /push - 推送全量数据到服务器
 * GET /pull - 从服务器拉取全量数据
 */
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import { db, iconCountByFilename, kvGetAll, kvRemove, kvSet, iconGet, iconGetAll, iconSet, getIconPath } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router: ExpressRouter = Router()

router.use(authMiddleware)

const SAFE_ICON_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

const MAX_ICON_BYTES = (() => {
  const raw = process.env.MAX_ICON_BYTES
  if (!raw) return 1024 * 1024
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1024 * 1024
})()

const MAX_SYNC_KEYS = (() => {
  const raw = process.env.MAX_SYNC_KEYS
  if (!raw) return 200
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
})()

const MAX_SYNC_VALUE_BYTES = (() => {
  const raw = process.env.MAX_SYNC_VALUE_BYTES
  if (!raw) return 2 * 1024 * 1024
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 1024 * 1024
})()

const MAGIC_BYTES: Record<string, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/webp': Buffer.from('RIFF', 'ascii'),
  'image/gif': Buffer.from('GIF8', 'ascii')
}

function validateMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  const magic = MAGIC_BYTES[declaredMime]
  if (!magic || buffer.length < magic.length) return false
  for (let i = 0; i < magic.length; i += 1) {
    if (buffer[i] !== magic[i]) return false
  }
  if (declaredMime === 'image/webp') {
    return buffer.length >= 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP'
  }
  return true
}

const SYNC_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

const isSyncKeyName = (key: string): boolean => {
  if (!SYNC_KEY_RE.test(key)) return false
  // Prevent prototype pollution-ish keys.
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false
  return true
}

const shouldSyncValue = (value: unknown): boolean => {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
    return bytes <= MAX_SYNC_VALUE_BYTES
  } catch {
    return false
  }
}

let pushInProgress = false

const writeTempFile = (targetPath: string, buffer: Buffer): string => {
  const rand = crypto.randomBytes(8).toString('hex')
  const tmpPath = `${targetPath}.tmp-${rand}`
  fs.writeFileSync(tmpPath, new Uint8Array(buffer))
  return tmpPath
}

const cleanupTempFile = (tmpPath: string) => {
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
  } catch {
    // ignore
  }
}

const writeBlobIfMissing = (targetPath: string, buffer: Buffer): boolean => {
  if (fs.existsSync(targetPath)) return false
  const tmpPath = writeTempFile(targetPath, buffer)
  try {
    fs.renameSync(tmpPath, targetPath)
    return true
  } catch (e: unknown) {
    cleanupTempFile(tmpPath)
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'EEXIST' && fs.existsSync(targetPath)) {
      return false
    }
    throw e
  }
}

// GET /pull - 从服务器拉取全量数据
router.get('/pull', (req: Request, res: Response) => {
  try {
    const allData = kvGetAll()
    const icons = iconGetAll()

    // 构建设置数据
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(allData)) {
      if (!isSyncKeyName(key)) continue
      if (!shouldSyncValue(value)) continue
      data[key] = value
    }

    const wantsV2 = String(req.query.v ?? '') === '2'
    const wantsV1 = String(req.query.v ?? '') === '1'

    // Default to v3 (lightweight, no base64 icon data)
    if (!wantsV1 && !wantsV2) {
      return res.json({
        version: 3,
        data: {
          settings: data,
          iconIds: icons.map((i) => i.id)
        }
      })
    }

    // Legacy v2: include base64 icon data (heavy, kept for backward compat)
    const customIcons: Record<string, string> = {}
    for (const icon of icons) {
      const filePath = getIconPath(icon.filename)
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath)
        const base64 = buffer.toString('base64')
        customIcons[icon.id] = `data:${icon.mime_type};base64,${base64}`
      }
    }

    if (wantsV2) {
      return res.json({
        version: 2,
        data: {
          settings: data,
          customIcons
        }
      })
    }

    // Legacy v1
    if (Object.keys(customIcons).length > 0) {
      ;(data as Record<string, unknown>).customIcons = customIcons
    }

    return res.json({
      version: 1,
      data
    })
  } catch (e) {
    console.error('Failed to pull data:', e)
    res.status(500).json({ error: 'Failed to pull data' })
  }
})

// POST /push - 推送全量数据到服务器
router.post('/push', (req: Request, res: Response) => {
  if (pushInProgress) {
    return res.status(409).json({ error: 'Sync push already in progress' })
  }

  pushInProgress = true

  try {
    const payload = req.body
    const version = Number(payload?.version ?? 1)

    const dataContainer = payload?.data ?? payload
    if (!dataContainer || typeof dataContainer !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    const incomingSettings = (() => {
      if (version === 2) {
        const settings = (dataContainer as any)?.settings
        if (settings && typeof settings === 'object') return settings as Record<string, unknown>
        return null
      }
      if (version === 3) {
        const settings = (dataContainer as any)?.settings
        if (settings && typeof settings === 'object') return settings as Record<string, unknown>
        return null
      }
      return dataContainer as Record<string, unknown>
    })()

    if (!incomingSettings || typeof incomingSettings !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    const incomingCustomIcons = (() => {
      if (version === 3) return null
      if (version === 2) return (dataContainer as any)?.customIcons
      return (dataContainer as any)?.customIcons
    })()

    // Collect settings first (validate shape, avoid partial writes).
    const entries = Object.entries(incomingSettings as Record<string, unknown>)
    if (entries.length > MAX_SYNC_KEYS) {
      return res.status(413).json({ error: 'Too many keys in sync payload' })
    }

    const settingsToWrite: Record<string, unknown> = Object.create(null)
    for (const [key, value] of entries) {
      if (key === 'customIcons') continue
      if (!isSyncKeyName(key)) {
        return res.status(400).json({ error: `Invalid sync key: ${key}` })
      }
      if (!shouldSyncValue(value)) {
        return res.status(413).json({ error: `Value too large or invalid for key: ${key}` })
      }
      settingsToWrite[key] = value
    }

    // Parse customIcons into an operation list up front (so we can fail fast).
    const iconOps: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number; buffer: Buffer; hash: string; oldFilename?: string }> = []
    if (incomingCustomIcons && typeof incomingCustomIcons === 'object') {
      for (const [appId, dataUri] of Object.entries(incomingCustomIcons as Record<string, unknown>)) {
        if (typeof appId !== 'string' || !SAFE_ICON_ID_RE.test(appId)) continue
        if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) continue

        const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/)
        if (!match) continue

        const [, ext, base64Data] = match
        const mimeType = EXT_TO_MIME[ext]
        if (!mimeType) continue

        const buffer = Buffer.from(base64Data, 'base64')
        if (buffer.length > MAX_ICON_BYTES) {
          return res.status(413).json({ error: `Icon too large: ${appId}` })
        }
        if (!validateMagicBytes(buffer, mimeType)) {
          return res.status(400).json({ error: `Icon content does not match declared type: ${appId}` })
        }

        const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
        const hash = crypto.createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
        const filename = `${hash}.${normalizedExt}`
        const existing = iconGet(appId)

        iconOps.push({
          id: appId,
          filename,
          mimeType,
          sizeBytes: buffer.length,
          buffer,
          hash,
          oldFilename: existing?.filename
        })
      }
    }

    const createdFiles = new Set<string>()

    try {
      for (const op of iconOps) {
        const targetPath = getIconPath(op.filename)
        if (writeBlobIfMissing(targetPath, op.buffer)) {
          createdFiles.add(targetPath)
        }
      }

      // Commit DB changes in a single transaction.
      const tx = db.transaction(() => {
        const incomingKeys = new Set(Object.keys(settingsToWrite))
        for (const key of Object.keys(kvGetAll())) {
          if (isSyncKeyName(key) && !incomingKeys.has(key)) {
            kvRemove(key)
          }
        }
        for (const [key, value] of Object.entries(settingsToWrite)) {
          kvSet(key, value)
        }
        for (const op of iconOps) {
          iconSet(op.id, op.filename, op.mimeType, op.sizeBytes, op.hash)
        }
      })
      tx()

      // Best-effort cleanup: remove old unreferenced blobs.
      for (const op of iconOps) {
        if (op.oldFilename && op.oldFilename !== op.filename && iconCountByFilename(op.oldFilename) === 0) {
          try {
            fs.unlinkSync(getIconPath(op.oldFilename))
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      for (const filePath of createdFiles) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        } catch {
          // ignore
        }
      }
      throw e
    }

    res.json({ success: true })
  } catch (e) {
    console.error('Failed to push data:', e)
    res.status(500).json({ error: 'Failed to push data' })
  } finally {
    pushInProgress = false
  }
})

export default router
