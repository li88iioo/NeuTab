import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
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

const normalizeIpLiteral = (value: string): string => {
  const normalized = value.replace(/^\[|\]$/g, '').toLowerCase()
  const ipv4Mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  return ipv4Mapped ? ipv4Mapped[1] : normalized
}

const isIpLiteral = (value: string): boolean => isIP(normalizeIpLiteral(value)) !== 0

const isPrivateOrReservedIp = (ip: string): boolean => {
  const normalized = normalizeIpLiteral(ip)
  const version = isIP(normalized)

  if (version === 4) {
    const parts = normalized.split('.').map((p) => Number(p))
    const [a, b, c, d] = parts
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true
    if (a === 127 || a === 10) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0 && c === 0) return true
    if (a === 192 && b === 0 && c === 2) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a === 198 && b === 51 && c === 100) return true
    if (a === 203 && b === 0 && c === 113) return true
    if (a >= 224) return true
    if (a === 255 && b === 255 && c === 255 && d === 255) return true
    return false
  }

  if (version === 6) {
    if (normalized.startsWith('::ffff:')) return true
    if (normalized === '::' || normalized === '::1') return true
    if (/^fe[89ab][0-9a-f]*:/i.test(normalized)) return true
    if (/^f[cd][0-9a-f]*:/i.test(normalized)) return true
    if (/^ff[0-9a-f]*:/i.test(normalized)) return true
    if (/^2001:db8:/i.test(normalized)) return true
    return false
  }

  return false
}

const MAX_FAVICON_BYTES = 256 * 1024

async function assertPublicFetchHost(hostname: string): Promise<string> {
  const normalized = normalizeIpLiteral(hostname)
  if (isIP(normalized)) {
    if (isPrivateOrReservedIp(normalized)) throw new Error('Blocked private favicon host')
    return normalized
  }

  const records = await lookup(normalized, { all: true, verbatim: true })
  if (records.length === 0) throw new Error('Favicon host did not resolve')
  const resolvedIp = records[0].address
  if (records.some((record) => isPrivateOrReservedIp(record.address))) {
    throw new Error('Blocked private favicon host')
  }
  return resolvedIp
}

async function fetchPublicUrl(url: string): Promise<globalThis.Response> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Unsupported favicon URL protocol')
  }
  await assertPublicFetchHost(parsed.hostname)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'NeuTabFaviconProxy/1.0'
      }
    }).finally(() => clearTimeout(timer))

    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function streamReadWithLimit(res: globalThis.Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) throw new Error('Empty response body')
  const cl = res.headers.get('content-length')
  if (cl && Number(cl) > maxBytes) throw new Error('Favicon too large')

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
      if (total > maxBytes) throw new Error('Favicon too large')
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

const isValidDomain = (domain: string): boolean => {
  const d = domain.trim().toLowerCase()
  if (!d || d.length > 255) return false

  if (isIpLiteral(d)) {
    return !isPrivateOrReservedIp(d)
  }

  // Block localhost
  if (d === 'localhost') return false

  // Block .local, .internal, .localhost TLDs
  if (/\.(local|internal|localhost)$/i.test(d)) return false

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
  const rand = crypto.randomBytes(6).toString('hex')
  const tmpMeta = path.join(CACHE_DIR, `${key}.json.tmp-${rand}`)
  const tmpBody = path.join(CACHE_DIR, `${key}.bin.tmp-${rand}`)

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
  const rand = crypto.randomBytes(6).toString('hex')
  const tmpMeta = path.join(CACHE_DIR, `${key}.json.tmp-${rand}`)

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
  let currentUrl = url
  let res: globalThis.Response | null = null

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    res = await fetchPublicUrl(currentUrl)

    if (res.status < 300 || res.status >= 400) break

    const nextUrl = res.headers.get('location')
    if (!nextUrl) throw new Error('Redirect missing location')
    currentUrl = new URL(nextUrl, currentUrl).toString()
  }

  if (!res) throw new Error('Favicon fetch failed')
  if (res.status >= 300 && res.status < 400) throw new Error('Too many favicon redirects')

  if (!res.ok) {
    throw new UpstreamHttpError(res.status)
  }

  const contentType = normalizeIconContentType(res.headers.get('content-type'), currentUrl)
  if (!contentType) {
    throw new Error(`Unexpected content-type: ${res.headers.get('content-type') || '(missing)'}`)
  }

  const body = await streamReadWithLimit(res, MAX_FAVICON_BYTES)

  return { contentType, body }
}

async function fetchFromGoogle(domain: string, size: number): Promise<{ contentType: string; body: Buffer }> {
  const googleDomain = isIpLiteral(domain) ? normalizeIpLiteral(domain) : domain
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(googleDomain)}&sz=${size}`
  return fetchIconFromUrl(url)
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
      try {
        const fresh = await fetchFromGoogle(domain, size)
        await writeCache(key, fresh.contentType, fresh.body)
        return fresh
      } catch (e) {
        if (e instanceof UpstreamHttpError && e.status === 404) {
          await writeNegativeCache(key)
          return null
        }
        throw e
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
