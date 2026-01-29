/**
 * @plasmohq/storage 兼容垫片 - 网页版
 * 数据存储在服务器 data 目录，localStorage 作为缓存
 */
import { useState, useEffect, useCallback, useRef } from 'react'

type StorageArea = 'local' | 'sync' | 'session'
type WatchCallback<T> = (change: { newValue?: T; oldValue?: T }) => void

const STORAGE_EVENT_KEY = 'neutab-storage-update'
export const AUTH_LOGOUT_EVENT = 'neutab-auth-logout'
const KV_INDEX_KEY = 'neutab_kv_index_v1'

interface StorageChangeEvent {
  key: string
  newValue: unknown
  oldValue: unknown
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

function dispatchLogout(reason = 'unauthorized') {
  try {
    localStorage.removeItem('neutab_token')
  } catch {
    // ignore
  }
  initPromise = null
  try {
    window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT, { detail: { reason } }))
  } catch {
    // ignore
  }
}

function readKvIndex(): Set<string> {
  try {
    const raw = localStorage.getItem(KV_INDEX_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((k) => typeof k === 'string') as string[])
  } catch {
    return new Set()
  }
}

function writeKvIndex(keys: Set<string>) {
  try {
    localStorage.setItem(KV_INDEX_KEY, JSON.stringify(Array.from(keys).sort()))
  } catch {
    // ignore
  }
}

function trackKvKey(key: string) {
  const keys = readKvIndex()
  keys.add(key)
  writeKvIndex(keys)
}

function untrackKvKey(key: string) {
  const keys = readKvIndex()
  if (!keys.delete(key)) return
  writeKvIndex(keys)
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('neutab_token')
  if (token) {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  }
  return { 'Content-Type': 'application/json' }
}

async function readJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function throwIfUnauthorized(res: Response) {
  if (res.status !== 401) return
  dispatchLogout('token_invalid')
  throw new UnauthorizedError()
}

/**
 * Storage 类 - 兼容 @plasmohq/storage
 * 网页版：数据存服务器，localStorage 做缓存
 */
export class Storage {
  private area: StorageArea
  private prefix: string

  constructor(options?: { area?: StorageArea; prefix?: string }) {
    this.area = options?.area || 'local'
    this.prefix = options?.prefix || ''
  }

  private getKey(key: string): string {
    // 使用 _ 分隔（而非 :），与服务端 key 正则 ^[a-zA-Z_][a-zA-Z0-9_]* 兼容
    return this.prefix ? `${this.prefix}_${key}` : key
  }

  private getCache(): globalThis.Storage {
    if (this.area === 'session') {
      return sessionStorage
    }
    return localStorage
  }

  /**
   * 同步读取（从缓存）
   */
  getSync<T>(key: string): T | undefined {
    try {
      const raw = this.getCache().getItem(this.getKey(key))
      if (raw === null) return undefined
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }

  /**
   * 异步读取（优先缓存，后台从服务器更新）
   */
  async get<T>(key: string): Promise<T | undefined> {
    const fullKey = this.getKey(key)

    // 先返回缓存
    const cached = this.getSync<T>(key)

    // 后台从服务器获取最新数据
    try {
      const res = await fetch(`/api/storage/get/${encodeURIComponent(fullKey)}`, {
        headers: getAuthHeaders()
      })
      throwIfUnauthorized(res)
      if (res.ok) {
        const payload = await readJsonSafe(res)
        const found = Boolean(payload?.found)
        const value = payload?.value
        if (found) {
          this.getCache().setItem(fullKey, JSON.stringify(value))
          trackKvKey(fullKey)
          return value as T
        }
        // Key missing on server - clear local cache to avoid staleness.
        this.getCache().removeItem(fullKey)
        untrackKvKey(fullKey)
        return undefined
      }
    } catch {
      // 网络错误，使用缓存
    }

    return cached
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = Object.create(null)
    const cache = this.getCache()

    // Fill from cache first.
    for (const key of keys) {
      result[key] = this.getSync(key)
    }

    const fullKeys = keys.map((k) => this.getKey(k))
    try {
      const res = await fetch('/api/storage/getMany', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ keys: fullKeys })
      })
      throwIfUnauthorized(res)
      if (!res.ok) return result

      const payload = await readJsonSafe(res)
      const items = (payload?.items && typeof payload.items === 'object') ? (payload.items as Record<string, unknown>) : null
      if (!items) return result

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const fullKey = fullKeys[i]
        const has = Object.prototype.hasOwnProperty.call(items, fullKey)
        if (has) {
          cache.setItem(fullKey, JSON.stringify(items[fullKey]))
          trackKvKey(fullKey)
          result[key] = items[fullKey]
        } else {
          cache.removeItem(fullKey)
          untrackKvKey(fullKey)
          result[key] = undefined
        }
      }
    } catch {
      // ignore - return best-effort cached result
    }

    return result
  }

  /**
   * 写入数据（同时写缓存和服务器）
   */
  async set(key: string, value: unknown): Promise<void> {
    const fullKey = this.getKey(key)
    const cache = this.getCache()
    const oldValue = cache.getItem(fullKey)
    const newValue = JSON.stringify(value)

    // 立即写入缓存
    cache.setItem(fullKey, newValue)
    trackKvKey(fullKey)

    // 触发本地事件
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
      detail: {
        key: fullKey,
        newValue: value,
        oldValue: oldValue ? JSON.parse(oldValue) : undefined
      } as StorageChangeEvent
    }))

    // 异步写入服务器
    try {
      const res = await fetch('/api/storage/set', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ key: fullKey, value })
      })
      throwIfUnauthorized(res)
      if (!res.ok) {
        const payload = await readJsonSafe(res)
        throw new Error(payload?.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      console.error('Failed to save to server:', e)
      // Roll back local cache to avoid silently diverging from server state.
      try {
        if (oldValue === null) {
          cache.removeItem(fullKey)
          untrackKvKey(fullKey)
        } else {
          cache.setItem(fullKey, oldValue)
          trackKvKey(fullKey)
        }
        window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
          detail: {
            key: fullKey,
            newValue: oldValue ? JSON.parse(oldValue) : undefined,
            oldValue: value
          } as StorageChangeEvent
        }))
      } catch {
        // ignore
      }
    }
  }

  /**
   * 批量写入（同时写缓存和服务器）
   * 注意：为了兼容 watch 行为，这里会为每个 key 派发一次本地事件。
   */
  async setMany(items: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(items)
    if (entries.length === 0) return

    const cache = this.getCache()
    const oldValues = new Map<string, string | null>()
    const toWrite: Record<string, unknown> = Object.create(null)

    // 先落缓存 + 派发事件（与 set 行为一致：立即更新 UI）
    for (const [key, value] of entries) {
      const fullKey = this.getKey(key)
      const oldRaw = cache.getItem(fullKey)
      oldValues.set(fullKey, oldRaw)

      cache.setItem(fullKey, JSON.stringify(value))
      trackKvKey(fullKey)
      toWrite[fullKey] = value

      try {
        window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
          detail: {
            key: fullKey,
            newValue: value,
            oldValue: oldRaw ? JSON.parse(oldRaw) : undefined
          } as StorageChangeEvent
        }))
      } catch {
        // ignore
      }
    }

    try {
      const res = await fetch('/api/storage/setMany', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ items: toWrite })
      })
      throwIfUnauthorized(res)
      if (!res.ok) {
        const payload = await readJsonSafe(res)
        throw new Error(payload?.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      console.error('Failed to save setMany to server:', e)
      // Roll back local cache to avoid silently diverging from server state.
      try {
        for (const [fullKey, oldRaw] of oldValues.entries()) {
          if (oldRaw === null) {
            cache.removeItem(fullKey)
            untrackKvKey(fullKey)
          } else {
            cache.setItem(fullKey, oldRaw)
            trackKvKey(fullKey)
          }
          try {
            window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
              detail: {
                key: fullKey,
                newValue: oldRaw ? JSON.parse(oldRaw) : undefined,
                oldValue: toWrite[fullKey]
              } as StorageChangeEvent
            }))
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
  }

  async remove(key: string): Promise<void> {
    const fullKey = this.getKey(key)
    const cache = this.getCache()
    const oldValue = cache.getItem(fullKey)

    cache.removeItem(fullKey)
    untrackKvKey(fullKey)

    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
      detail: {
        key: fullKey,
        newValue: undefined,
        oldValue: oldValue ? JSON.parse(oldValue) : undefined
      } as StorageChangeEvent
    }))

    try {
      const res = await fetch('/api/storage/remove', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ key: fullKey })
      })
      throwIfUnauthorized(res)
      if (!res.ok) {
        const payload = await readJsonSafe(res)
        throw new Error(payload?.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      console.error('Failed to remove from server:', e)
      // Restore local cache on failure.
      try {
        if (oldValue !== null) {
          cache.setItem(fullKey, oldValue)
          trackKvKey(fullKey)
          window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY, {
            detail: {
              key: fullKey,
              newValue: JSON.parse(oldValue),
              oldValue: undefined
            } as StorageChangeEvent
          }))
        }
      } catch {
        // ignore
      }
    }
  }

  watch<T>(callback: WatchCallback<T>): () => void
  watch<T>(key: string, callback: WatchCallback<T>): () => void
  watch<T>(keyOrCallback: string | WatchCallback<T>, maybeCallback?: WatchCallback<T>): () => void {
    const key = typeof keyOrCallback === 'string' ? this.getKey(keyOrCallback) : null
    const callback = typeof keyOrCallback === 'function' ? keyOrCallback : maybeCallback!

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<StorageChangeEvent>).detail
      if (key === null || detail.key === key) {
        callback({
          newValue: detail.newValue as T,
          oldValue: detail.oldValue as T
        })
      }
    }

    window.addEventListener(STORAGE_EVENT_KEY, handler)

    const storageHandler = (e: StorageEvent) => {
      if (key === null || e.key === key) {
        callback({
          newValue: e.newValue ? JSON.parse(e.newValue) : undefined,
          oldValue: e.oldValue ? JSON.parse(e.oldValue) : undefined
        })
      }
    }
    window.addEventListener('storage', storageHandler)

    return () => {
      window.removeEventListener(STORAGE_EVENT_KEY, handler)
      window.removeEventListener('storage', storageHandler)
    }
  }

  async getAll(): Promise<Record<string, unknown>> {
    try {
      const res = await fetch('/api/storage/all', {
        headers: getAuthHeaders()
      })
      throwIfUnauthorized(res)
      if (res.ok) {
        return await res.json()
      }
    } catch {
      // 网络错误
    }

    // 回退到缓存
    const cache = this.getCache()
    const result: Record<string, unknown> = Object.create(null)
    const knownKeys = readKvIndex()
    for (const storedKey of knownKeys) {
      if (!this.prefix || storedKey.startsWith(this.prefix + '_')) {
        try {
          const actualKey = this.prefix ? storedKey.slice(this.prefix.length + 1) : storedKey
          const raw = cache.getItem(storedKey)
          if (raw === null) continue
          result[actualKey] = JSON.parse(raw)
        } catch {
          // ignore
        }
      }
    }
    return result
  }

  async clear(): Promise<void> {
    const cache = this.getCache()
    const knownKeys = readKvIndex()
    const keysToRemove: string[] = []
    for (const storedKey of knownKeys) {
      if (!this.prefix || storedKey.startsWith(this.prefix + '_')) {
        keysToRemove.push(storedKey)
      }
    }

    for (const k of keysToRemove) {
      try {
        cache.removeItem(k)
      } catch {
        // ignore
      }
      untrackKvKey(k)
    }
  }
}

// 默认存储实例
const defaultStorage = new Storage()

interface UseStorageOptions {
  key: string
  instance?: Storage
}

/**
 * 初始化：从服务器加载所有数据到缓存
 */
let initPromise: Promise<void> | null = null

export async function initStorageFromServer(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const res = await fetch('/api/storage/all', {
        headers: getAuthHeaders()
      })
      throwIfUnauthorized(res)
      if (res.ok) {
        const data = await res.json()
        const nextKeys = new Set<string>()
        for (const [key, value] of Object.entries(data)) {
          localStorage.setItem(key, JSON.stringify(value))
          nextKeys.add(key)
        }

        // Remove keys we previously cached but no longer exist on server.
        const prevKeys = readKvIndex()
        for (const oldKey of prevKeys) {
          if (!nextKeys.has(oldKey)) {
            localStorage.removeItem(oldKey)
          }
        }

        writeKvIndex(nextKeys)
      }
    } catch (e) {
      console.error('[Storage] Failed to load from server:', e)
      initPromise = null
      // If auth is invalid, make sure UI goes back to login state.
      if (e instanceof UnauthorizedError) throw e
    }
  })()

  return initPromise
}

/**
 * useStorage hook - 兼容 @plasmohq/storage/hook
 */
export function useStorage<T>(
  keyOrOptions: string | UseStorageOptions,
  defaultValue?: T | ((v: T | undefined) => T)
): [T | undefined, (value: T | ((prev: T | undefined) => T)) => Promise<void>, { isLoading: boolean }] {
  const key = typeof keyOrOptions === 'string' ? keyOrOptions : keyOrOptions.key
  const instance = typeof keyOrOptions === 'string' ? defaultStorage : (keyOrOptions.instance || defaultStorage)

  const storageRef = useRef(instance)
  const defaultValueRef = useRef(defaultValue)

  // 同步初始化：从缓存读取
  const [value, setValue] = useState<T | undefined>(() => {
    const stored = instance.getSync<T>(key)
    if (stored !== undefined) {
      return stored
    }
    const def = defaultValue
    return typeof def === 'function' ? (def as (v: T | undefined) => T)(undefined) : def
  })

  const [isLoading] = useState(false)
  const valueRef = useRef(value)
  valueRef.current = value

  // 监听变化
  useEffect(() => {
    const unwatch = storageRef.current.watch<T>(key, ({ newValue }) => {
      if (newValue !== undefined) {
        setValue(newValue)
      } else {
        const def = defaultValueRef.current
        const resolved = typeof def === 'function' ? (def as (v: T | undefined) => T)(undefined) : def
        setValue(resolved)
      }
    })
    return unwatch
  }, [key])

  const setStorageValue = useCallback(async (newValue: T | ((prev: T | undefined) => T)) => {
    const resolvedValue = typeof newValue === 'function'
      ? (newValue as (prev: T | undefined) => T)(valueRef.current)
      : newValue
    setValue(resolvedValue)
    await storageRef.current.set(key, resolvedValue)
  }, [key])

  return [value, setStorageValue, { isLoading }]
}

export default Storage
