import { isHttpUrl } from "./validation"

type CacheEntry = {
  ok: boolean
  expiresAt: number
}

// In-memory, session-scoped cache. Avoid persistent storage to reduce "network scanning" concerns.
const reachabilityCache = new Map<string, CacheEntry>()
const inflightProbes = new Map<string, Promise<boolean>>()

const now = () => Date.now()

const getCacheKey = (url: string) => {
  try {
    const u = new URL(url)
    return u.origin
  } catch {
    return url
  }
}

const getCached = (key: string): CacheEntry | null => {
  const entry = reachabilityCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now()) {
    reachabilityCache.delete(key)
    return null
  }
  return entry
}

/**
 * Best-effort reachability probe for an http(s) URL.
 * - We intentionally use `no-cors` and never read the response body.
 * - Some servers may include CORP/CORS headers that cause a fetch rejection even when they are reachable.
 *   In that case we treat the URL as reachable (optimistic), because normal navigation still works.
 */
export const probeHttpReachable = async (url: string, timeoutMs: number): Promise<boolean> => {
  if (!isHttpUrl(url)) return false

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      credentials: "omit",
      signal: controller.signal
    })
    return true
  } catch {
    // Timeout -> unreachable. Other errors are often caused by CORP/CORS restrictions; be optimistic.
    return controller.signal.aborted ? false : true
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Synchronous "fast path" resolver.
 * - Uses in-memory cache only; never triggers network I/O.
 * - If there's no cached verdict yet, falls back to defaultUrl.
 */
export const peekResolvedInternalUrl = (opts: {
  enabled: boolean
  internalUrl?: string
  defaultUrl?: string
}): string => {
  const internalUrl = (opts.internalUrl || "").trim()
  const defaultUrl = (opts.defaultUrl || "").trim()

  if (!internalUrl) return defaultUrl
  if (!defaultUrl) return internalUrl
  if (!opts.enabled) return defaultUrl

  // Non-HTTP internal URLs can't/needn't be probed; prefer them directly (explicit user intent).
  if (!isHttpUrl(internalUrl)) return internalUrl

  const key = getCacheKey(internalUrl)
  const cached = getCached(key)
  if (!cached) return defaultUrl
  return cached.ok ? internalUrl : defaultUrl
}

/**
 * Ensure the given internal URL has a cached reachability verdict.
 * Returns the verdict when the probe is performed, or the cached verdict when present.
 */
export const ensureInternalUrlProbed = async (opts: {
  internalUrl: string
  timeoutMs: number
  cacheTtlMs?: number
  negativeCacheTtlMs?: number
}): Promise<boolean> => {
  const internalUrl = (opts.internalUrl || "").trim()
  if (!isHttpUrl(internalUrl)) return false

  const cacheTtlMs = opts.cacheTtlMs ?? 60_000
  const negativeCacheTtlMs = opts.negativeCacheTtlMs ?? 10_000

  const key = getCacheKey(internalUrl)
  const cached = getCached(key)
  if (cached) return cached.ok

  const inflight = inflightProbes.get(key)
  if (inflight) return inflight

  const p = (async () => {
    const ok = await probeHttpReachable(internalUrl, opts.timeoutMs)
    reachabilityCache.set(key, {
      ok,
      expiresAt: now() + (ok ? cacheTtlMs : negativeCacheTtlMs)
    })
    return ok
  })()

  inflightProbes.set(key, p)
  try {
    return await p
  } finally {
    inflightProbes.delete(key)
  }
}

