import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import { DATA_DIR } from '../db.js'

const router: ExpressRouter = Router()

const CACHE_DIR = path.join(DATA_DIR, 'favicon-cache')
fs.mkdirSync(CACHE_DIR, { recursive: true })

const inflight = new Map<string, Promise<{ contentType: string; body: Buffer } | null>>()

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60
const TTL_SECONDS = (() => {
  const raw = process.env.FAVICON_CACHE_TTL_SECONDS
  if (!raw) return DEFAULT_TTL_SECONDS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TTL_SECONDS
})()

const DEFAULT_NEGATIVE_TTL_SECONDS = 60 * 60
const NEGATIVE_TTL_SECONDS = (() => {
  const raw = process.env.FAVICON_NEGATIVE_CACHE_TTL_SECONDS
  if (!raw) return DEFAULT_NEGATIVE_TTL_SECONDS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_NEGATIVE_TTL_SECONDS
})()

const UPSTREAM_TIMEOUT_MS = (() => {
  const raw = process.env.FAVICON_UPSTREAM_TIMEOUT_MS
  if (!raw) return 8000
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8000
})()

type CacheMeta = {
  contentType?: string
  fetchedAt?: number
  notFound?: boolean
}

type CachedEntry =
  | { contentType: string; body: Buffer; isFresh: boolean; notFound: false }
  | { isFresh: boolean; notFound: true }

class UpstreamHttpError extends Error {
  status: number

  constructor(status: number) {
    super(`Upstream error: ${status}`)
    this.name = 'UpstreamHttpError'
    this.status = status
  }
}

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
        const meta = JSON.parse(metaRaw) as CacheMeta
        const fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
        const ttlSeconds = meta.notFound ? NEGATIVE_TTL_SECONDS : TTL_SECONDS
        const expired = fetchedAt > 0 && now - fetchedAt > ttlSeconds * 1000
        if (expired) {
          await Promise.allSettled([fsp.unlink(metaPath), fsp.unlink(bodyPath)])
          continue
        }

        // Negative cache entry doesn't need body file.
        if (meta.notFound) {
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

async function readCache(key: string): Promise<CachedEntry | null> {
  const metaPath = path.join(CACHE_DIR, `${key}.json`)
  const bodyPath = path.join(CACHE_DIR, `${key}.bin`)

  try {
    const metaRaw = await fsp.readFile(metaPath, 'utf-8')
    const meta = JSON.parse(metaRaw) as CacheMeta
    const fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
    const ttlSeconds = meta.notFound ? NEGATIVE_TTL_SECONDS : TTL_SECONDS
    const isFresh = fetchedAt > 0 && Date.now() - fetchedAt < ttlSeconds * 1000

    if (meta.notFound) {
      return { isFresh, notFound: true }
    }

    const body = await fsp.readFile(bodyPath)
    const contentType = typeof meta.contentType === 'string' ? meta.contentType : 'image/png'
    return { contentType, body, isFresh, notFound: false }
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

async function writeNegativeCache(key: string): Promise<void> {
  const metaPath = path.join(CACHE_DIR, `${key}.json`)
  const bodyPath = path.join(CACHE_DIR, `${key}.bin`)
  const tmpMeta = path.join(CACHE_DIR, `${key}.json.tmp`)

  await fsp.writeFile(tmpMeta, JSON.stringify({ fetchedAt: Date.now(), notFound: true }))
  await Promise.allSettled([fsp.unlink(bodyPath)])
  await fsp.rename(tmpMeta, metaPath)
}

const normalizeIconContentType = (contentTypeHeader: string | null, urlHint: string): string | null => {
  const raw = String(contentTypeHeader || '').split(';')[0].trim().toLowerCase()
  if (!raw) {
    if (urlHint.endsWith('.ico')) return 'image/x-icon'
    return null
  }
  if (raw.startsWith('image/')) return raw
  if (raw === 'application/octet-stream' && urlHint.endsWith('.ico')) return 'image/x-icon'
  if (raw.includes('icon')) return 'image/x-icon'
  return null
}

async function fetchIconFromUrl(url: string): Promise<{ contentType: string; body: Buffer }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  const res = await fetch(url, {
    signal: controller.signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'NeuTabFaviconProxy/1.0'
    }
  }).finally(() => clearTimeout(timer))

  if (!res.ok) {
    throw new UpstreamHttpError(res.status)
  }

  const contentType = normalizeIconContentType(res.headers.get('content-type'), url)
  if (!contentType) {
    throw new Error(`Unexpected content-type: ${res.headers.get('content-type') || '(missing)'}`)
  }

  const ab = await res.arrayBuffer()
  const body = Buffer.from(ab)
  if (body.length > 256 * 1024) {
    throw new Error('Favicon too large')
  }

  return { contentType, body }
}

async function fetchFromGoogle(domain: string, size: number): Promise<{ contentType: string; body: Buffer }> {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
  return fetchIconFromUrl(url)
}

async function fetchFromSiteOrigin(domain: string): Promise<{ contentType: string; body: Buffer }> {
  const candidates = [`https://${domain}/favicon.ico`]
  if (!domain.startsWith('www.')) {
    candidates.push(`https://www.${domain}/favicon.ico`)
  }

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      return await fetchIconFromUrl(candidate)
    } catch (e) {
      lastError = e
    }
  }

  throw lastError || new Error('Origin favicon fetch failed')
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
    if (cached.notFound) {
      res.setHeader('Cache-Control', 'public, max-age=600')
      res.setHeader('X-Cache', 'negative')
      return res.status(204).end()
    }
    res.setHeader('Content-Type', cached.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(cached.body)
  }

  // De-dup concurrent requests.
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      let googleError: unknown = null
      try {
        const fresh = await fetchFromGoogle(domain, size)
        await writeCache(key, fresh.contentType, fresh.body)
        return fresh
      } catch (e) {
        googleError = e
      }

      try {
        const fallback = await fetchFromSiteOrigin(domain)
        await writeCache(key, fallback.contentType, fallback.body)
        return fallback
      } catch (originError) {
        const google404 = googleError instanceof UpstreamHttpError && googleError.status === 404
        const origin404 = originError instanceof UpstreamHttpError && originError.status === 404
        if (google404 && origin404) {
          await writeNegativeCache(key)
          return null
        }
        throw googleError ?? originError
      }
    })()
    inflight.set(key, p)
  }

  try {
    const fresh = await p
    if (!fresh) {
      res.setHeader('Cache-Control', 'public, max-age=600')
      return res.status(204).end()
    }
    res.setHeader('Content-Type', fresh.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(fresh.body)
  } catch (e) {
    // If upstream fails, serve stale cache if present.
    if (cached) {
      if (cached.notFound) {
        res.setHeader('Cache-Control', 'public, max-age=300')
        res.setHeader('X-Cache', 'stale-negative')
        return res.status(204).end()
      }
      res.setHeader('Content-Type', cached.contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('X-Cache', 'stale')
      return res.send(cached.body)
    }

    if (e instanceof UpstreamHttpError && e.status === 404) {
      return res.status(204).end()
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
