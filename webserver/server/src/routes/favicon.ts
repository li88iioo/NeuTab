import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import { DATA_DIR } from '../db.js'

const router: ExpressRouter = Router()

const CACHE_DIR = path.join(DATA_DIR, 'favicon-cache')
fs.mkdirSync(CACHE_DIR, { recursive: true })

const inflight = new Map<string, Promise<{ contentType: string; body: Buffer }>>()

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60
const TTL_SECONDS = (() => {
  const raw = process.env.FAVICON_CACHE_TTL_SECONDS
  if (!raw) return DEFAULT_TTL_SECONDS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TTL_SECONDS
})()

const UPSTREAM_TIMEOUT_MS = (() => {
  const raw = process.env.FAVICON_UPSTREAM_TIMEOUT_MS
  if (!raw) return 8000
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8000
})()

async function cleanupCacheOnce(): Promise<void> {
  try {
    const files = await fsp.readdir(CACHE_DIR)
    const now = Date.now()
    const metaFiles = files.filter((f) => f.endsWith('.json'))

    for (const metaName of metaFiles) {
      const key = metaName.slice(0, -'.json'.length)
      const metaPath = path.join(CACHE_DIR, `${key}.json`)
      const bodyPath = path.join(CACHE_DIR, `${key}.bin`)

      try {
        const metaRaw = await fsp.readFile(metaPath, 'utf-8')
        const meta = JSON.parse(metaRaw) as { fetchedAt?: number }
        const fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
        const expired = fetchedAt > 0 && now - fetchedAt > TTL_SECONDS * 1000
        if (expired) {
          await Promise.allSettled([fsp.unlink(metaPath), fsp.unlink(bodyPath)])
          continue
        }
        // If body is missing, remove meta too.
        try {
          await fsp.access(bodyPath)
        } catch {
          await Promise.allSettled([fsp.unlink(metaPath)])
        }
      } catch {
        // Corrupt meta - remove best effort.
        await Promise.allSettled([fsp.unlink(metaPath), fsp.unlink(bodyPath)])
      }
    }
  } catch {
    // ignore
  }
}

// Best-effort background cleanup so cache doesn't grow forever.
cleanupCacheOnce().catch(() => {})
const cleanupInterval = setInterval(() => {
  void cleanupCacheOnce()
}, 6 * 60 * 60 * 1000)
;(cleanupInterval as any).unref?.()

const isValidDomain = (domain: string): boolean => {
  const d = domain.trim()
  if (!d || d.length > 255) return false
  // Hostname or IPv4. Keep strict enough to avoid weird cache-busting junk.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return true
  if (d === 'localhost') return true
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(d)
}

const parseSize = (raw: unknown): number => {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 64
  const i = Math.floor(n)
  return Math.max(16, Math.min(256, i))
}

const cacheKey = (domain: string, size: number): string => {
  return crypto.createHash('sha256').update(`${domain}|${size}`).digest('hex')
}

async function readCache(key: string): Promise<{ contentType: string; body: Buffer; isFresh: boolean } | null> {
  const metaPath = path.join(CACHE_DIR, `${key}.json`)
  const bodyPath = path.join(CACHE_DIR, `${key}.bin`)

  try {
    const [metaRaw, body] = await Promise.all([
      fsp.readFile(metaPath, 'utf-8'),
      fsp.readFile(bodyPath)
    ])
    const meta = JSON.parse(metaRaw) as { contentType?: string; fetchedAt?: number }
    const fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
    const isFresh = fetchedAt > 0 && Date.now() - fetchedAt < TTL_SECONDS * 1000
    const contentType = typeof meta.contentType === 'string' ? meta.contentType : 'image/png'
    return { contentType, body, isFresh }
  } catch {
    return null
  }
}

async function writeCache(key: string, contentType: string, body: Buffer): Promise<void> {
  const metaPath = path.join(CACHE_DIR, `${key}.json`)
  const bodyPath = path.join(CACHE_DIR, `${key}.bin`)
  const tmpMeta = path.join(CACHE_DIR, `${key}.json.tmp`)
  const tmpBody = path.join(CACHE_DIR, `${key}.bin.tmp`)

  await Promise.all([
    fsp.writeFile(tmpBody, body),
    fsp.writeFile(tmpMeta, JSON.stringify({ contentType, fetchedAt: Date.now() }))
  ])

  await Promise.all([
    fsp.rename(tmpBody, bodyPath),
    fsp.rename(tmpMeta, metaPath)
  ])
}

async function fetchFromGoogle(domain: string, size: number): Promise<{ contentType: string; body: Buffer }> {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
  if (!res.ok) {
    throw new Error(`Upstream error: ${res.status}`)
  }

  const contentType = res.headers.get('content-type') || 'image/png'
  if (!contentType.startsWith('image/')) {
    throw new Error(`Unexpected content-type: ${contentType}`)
  }

  const ab = await res.arrayBuffer()
  const body = Buffer.from(ab)
  // Defensive: favicon should be tiny; avoid unbounded disk writes.
  if (body.length > 256 * 1024) {
    throw new Error('Favicon too large')
  }

  return { contentType, body }
}

router.get('/', async (req: Request, res: Response) => {
  const domain = String(req.query.domain ?? '').trim().toLowerCase()
  const size = parseSize(req.query.sz ?? req.query.size ?? 64)

  if (!isValidDomain(domain)) {
    return res.status(400).json({ error: 'Invalid domain' })
  }

  const key = cacheKey(domain, size)

  const cached = await readCache(key)
  if (cached?.isFresh) {
    res.setHeader('Content-Type', cached.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(cached.body)
  }

  // De-dup concurrent requests.
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const fresh = await fetchFromGoogle(domain, size)
      await writeCache(key, fresh.contentType, fresh.body)
      return fresh
    })()
    inflight.set(key, p)
  }

  try {
    const fresh = await p
    res.setHeader('Content-Type', fresh.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(fresh.body)
  } catch (e) {
    // If upstream fails, serve stale cache if present.
    if (cached) {
      res.setHeader('Content-Type', cached.contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('X-Cache', 'stale')
      return res.send(cached.body)
    }
    if ((e as any)?.name === 'AbortError') {
      return res.status(504).json({ error: 'Favicon upstream timeout' })
    }
    console.error('[Favicon] Failed to fetch:', e)
    return res.status(502).json({ error: 'Failed to fetch favicon' })
  } finally {
    inflight.delete(key)
  }
})

export default router
