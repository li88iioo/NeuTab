/**
 * 图标文件 CRUD API
 * POST /upload - 上传图标（需鉴权）
 * POST /uploadRaw/:id - 上传图标（二进制，需鉴权）
 * GET /:id - 获取图标（无需鉴权，供 <img src> 使用）
 * DELETE /:id - 删除图标（需鉴权）
 */
import express, { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import { iconCountByFilename, iconGet, iconRemove, iconSet, getIconPath } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router: ExpressRouter = Router()

const SAFE_ICON_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const MAX_ICON_BYTES = (() => {
  const raw = process.env.MAX_ICON_BYTES
  if (!raw) return 1024 * 1024
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1024 * 1024
})()

const rawIconParser = express.raw({
  type: Object.keys(MIME_TO_EXT),
  limit: MAX_ICON_BYTES
})

function isSafeIconId(id: string): boolean {
  return SAFE_ICON_ID_RE.test(id)
}

function writeBlobIfMissing(targetPath: string, buffer: Buffer): void {
  if (fs.existsSync(targetPath)) return
  const rand = crypto.randomBytes(8).toString('hex')
  const tmpPath = `${targetPath}.tmp-${rand}`
  fs.writeFileSync(tmpPath, buffer)
  try {
    // If another request already created the same hash blob, overwriting is fine
    // because content is identical (same hash). Keep the logic simple.
    fs.renameSync(tmpPath, targetPath)
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore
    }
  }
}

// POST /upload - 上传图标
router.post('/upload', authMiddleware, (req: Request, res: Response) => {
  const { id, data } = req.body

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid id' })
  }

  if (!isSafeIconId(id)) {
    return res.status(400).json({ error: 'Invalid icon id format' })
  }

  if (!data || typeof data !== 'string' || !data.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid image data' })
  }

  try {
    // 解析 data URI
    const match = data.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      return res.status(400).json({ error: 'Invalid data URI format' })
    }

    const [, ext, base64Data] = match
    const mimeType = EXT_TO_MIME[ext]
    if (!mimeType) {
      return res.status(400).json({ error: 'Unsupported image type' })
    }
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > MAX_ICON_BYTES) {
      return res.status(413).json({ error: 'Icon too large' })
    }
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const filename = `${hash}.${normalizedExt}`
    const filePath = getIconPath(filename)

    const existing = iconGet(id)
    const oldFilename = existing?.filename

    try {
      writeBlobIfMissing(filePath, buffer)

      // Update DB after files are in place. On failure we rollback files.
      iconSet(id, filename, mimeType, buffer.length, hash)

      // Best-effort cleanup: remove old unreferenced blob.
      if (oldFilename && oldFilename !== filename && iconCountByFilename(oldFilename) === 0) {
        try {
          fs.unlinkSync(getIconPath(oldFilename))
        } catch {
          // ignore
        }
      }
    } catch (e) {
      throw e
    }

    res.json({ success: true, url: `/api/icons/${id}` })
  } catch (e) {
    console.error('Failed to save icon:', e)
    res.status(500).json({ error: 'Failed to save icon' })
  }
})

// POST /uploadRaw/:id - 上传图标（二进制）
router.post('/uploadRaw/:id', authMiddleware, rawIconParser, (req: Request, res: Response) => {
  const id = String(req.params.id ?? '')
  if (!id || !isSafeIconId(id)) {
    return res.status(400).json({ error: 'Invalid icon id format' })
  }

  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const normalizedExt = MIME_TO_EXT[contentType]
  if (!normalizedExt) {
    return res.status(400).json({ error: 'Unsupported image type' })
  }

  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([])
  if (!buffer.length) {
    return res.status(400).json({ error: 'Empty body' })
  }
  if (buffer.length > MAX_ICON_BYTES) {
    return res.status(413).json({ error: 'Icon too large' })
  }

  const mimeType = contentType
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const filename = `${hash}.${normalizedExt}`
  const filePath = getIconPath(filename)

  try {
    const existing = iconGet(id)
    const oldFilename = existing?.filename

    writeBlobIfMissing(filePath, buffer)

    // Update DB after files are in place. On failure we rollback files.
    iconSet(id, filename, mimeType, buffer.length, hash)

    if (oldFilename && oldFilename !== filename && iconCountByFilename(oldFilename) === 0) {
      try {
        fs.unlinkSync(getIconPath(oldFilename))
      } catch {
        // ignore
      }
    }

    return res.json({ success: true, url: `/api/icons/${id}` })
  } catch (e) {
    console.error('Failed to save icon:', e)
    return res.status(500).json({ error: 'Failed to save icon' })
  }
})

// GET /:id - 获取图标（无需鉴权）
// 图标不存在时返回 204 而非 404，避免控制台错误（<img> 会触发 onError 回退）
router.get('/blob/:filename', (req: Request, res: Response) => {
  const filename = String(req.params.filename ?? '').trim()

  // Only allow content-addressed blobs.
  if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid blob filename' })
  }

  const filePath = getIconPath(filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).end()
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  return res.sendFile(filePath)
})

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params

  if (!isSafeIconId(id)) {
    return res.status(400).json({ error: 'Invalid icon id format' })
  }

  const meta = iconGet(id)

  if (!meta) {
    return res.status(204).end()
  }

  const filePath = getIconPath(meta.filename)
  if (!fs.existsSync(filePath)) {
    return res.status(204).end()
  }

  // Indirect through the content-addressed blob so we can cache it forever,
  // while keeping /:id always correct when the mapping changes.
  res.setHeader('Cache-Control', 'no-store')
  return res.redirect(302, `/api/icons/blob/${encodeURIComponent(meta.filename)}`)
})

// DELETE /:id - 删除图标
router.delete('/:id', authMiddleware, (req: Request, res: Response) => {
  const { id } = req.params

  if (!isSafeIconId(id)) {
    return res.status(400).json({ error: 'Invalid icon id format' })
  }

  const meta = iconGet(id)

  if (meta) {
    iconRemove(id)
    if (iconCountByFilename(meta.filename) === 0) {
      const filePath = getIconPath(meta.filename)
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch {
          // ignore
        }
      }
    }
  }

  res.json({ success: true })
})

export default router
