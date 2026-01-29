import './env.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import storageRoutes from './routes/storage.js'
import iconsRoutes from './routes/icons.js'
import syncRoutes from './routes/sync.js'
import faviconRoutes from './routes/favicon.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.disable('x-powered-by')

const isOriginAllowed = (origin: string, allowList: string[]): boolean => {
  for (const rule of allowList) {
    if (!rule) continue
    if (rule === '*') return true
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1)
      if (origin.startsWith(prefix)) return true
      continue
    }
    if (origin === rule) return true
  }
  return false
}

type RateLimitOptions = {
  windowMs: number
  max: number
  key?: (req: express.Request) => string
  maxEntries?: number
}

function rateLimit({ windowMs, max, key, maxEntries = 50_000 }: RateLimitOptions): express.RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  const maxEntriesSafe = Math.max(1000, Math.floor(maxEntries))

  // Periodic cleanup to keep memory bounded.
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k)
    }
  }, Math.max(30_000, Math.floor(windowMs / 2)))
  // Don't keep the process alive just for cleanup.
  ;(cleanupInterval as any).unref?.()

  return (req, res, next) => {
    const now = Date.now()
    const k = key ? key(req) : (req.ip || 'unknown')
    const cur = hits.get(k)
    if (!cur || cur.resetAt <= now) {
      if (!hits.has(k) && hits.size >= maxEntriesSafe) {
        const first = hits.keys().next().value
        if (first) hits.delete(first)
      }
      hits.set(k, { count: 1, resetAt: now + windowMs })
      return next()
    }

    cur.count += 1
    if (cur.count <= max) return next()

    const retryAfterSeconds = Math.max(1, Math.ceil((cur.resetAt - now) / 1000))
    res.setHeader('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests', code: 'TOO_MANY_REQUESTS', retryAfter: retryAfterSeconds })
  }
}

// Basic security headers (no CSP here; keep the web client simple).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  )
  next()
})

// CORS for browser extension
app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowList = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowList.length === 0) {
    res.header('Access-Control-Allow-Origin', '*')
  } else if (typeof origin === 'string' && isOriginAllowed(origin, allowList)) {
    res.header('Access-Control-Allow-Origin', origin)
    res.header('Vary', 'Origin')
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Code')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// Optional: if you're behind a reverse proxy (nginx/caddy/cloudflare), set TRUST_PROXY=1
// so req.ip is derived from X-Forwarded-For.
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1)
}

// Rate-limit BEFORE any body parsing to reduce CPU/memory pressure under attack.
// Coarse global rate limit for API routes (per IP).
app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }))
// Stricter rate limit for login attempts (per IP).
app.use('/api/auth/login', rateLimit({ windowMs: 10 * 60_000, max: 20 }))

// Parse JSON for API routes only, and keep /api/auth/login tiny (prevent big-body abuse).
// Do NOT apply JSON parsing globally; otherwise attackers can send large bodies to non-API paths.
const jsonParser = express.json({ limit: '10mb' })
const loginJsonParser = express.json({ limit: '4kb' })
app.use('/api/auth/login', loginJsonParser)
app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/auth/login')) return next()
  return jsonParser(req, res, next)
})

app.use('/api/auth', authRoutes)
app.use('/api/storage', storageRoutes)
app.use('/api/icons', iconsRoutes)
app.use('/api/sync', syncRoutes)
app.use('/api/favicon', faviconRoutes)

// Serve static files.
// Keep this resilient to different build layouts:
// - legacy docker layout: /app/dist + /app/client/dist
// - workspace layout: /app/webserver/server/dist + /app/webserver/client/dist
const clientDistCandidates = [
  process.env.CLIENT_DIST_DIR,
  // legacy: /app/dist -> /app/client/dist
  path.join(__dirname, '../client/dist'),
  // dev: webserver/server/src -> webserver/client/dist
  path.join(__dirname, '../../client/dist'),
  // docker workspace: webserver/server/dist -> webserver/client/dist
  path.join(__dirname, '../../../client/dist')
].filter(Boolean) as string[]

const clientDist = clientDistCandidates.find((p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}) ?? path.join(__dirname, '../../client/dist')

app.use(express.static(clientDist, {
  setHeaders: (res, filePath) => {
    const normalized = filePath.split(path.sep).join('/')
    if (normalized.endsWith('/index.html') || normalized.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store')
      return
    }
    if (normalized.includes('/assets/')) {
      // Vite assets are content-hashed; safe to cache forever.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return
    }
    if (normalized.endsWith('.js') || normalized.endsWith('.css') || normalized.endsWith('.woff2') || normalized.endsWith('.svg')) {
      // Non-hashed files (e.g. theme-early-restore.js). Cache, but not forever.
      res.setHeader('Cache-Control', 'public, max-age=86400')
      return
    }
  }
}))

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' })
  }
  return res.sendFile(path.join(clientDist, 'index.html'))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`NeuTab server running on http://localhost:${PORT}`)
  if (!process.env.AUTH_CODE) {
    console.warn('AUTH_CODE not configured on server')
  }
})
