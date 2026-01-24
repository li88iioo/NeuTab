/**
 * IndexedDB Storage Layer
 * @description 本地持久化存储，不依赖扩展生命周期
 */

const DB_NAME = "NeuTabDB"
const DB_VERSION = 1
const STORE_GROUPS = "groups"
const STORE_ICONS = "icons"
const STORE_SETTINGS = "settings"

interface DataRecord<T> {
  data: T
  timestamp: number
  deviceId: string
}

let dbInstance: IDBDatabase | null = null
let deviceId: string | null = null

// 错误处理辅助函数
function handleTransactionError(operation: string, error: any): void {
  dbInstance = null
  console.error(`[IndexedDB] ${operation} failed:`, error)
}

async function isConnectionHealthy(db: IDBDatabase): Promise<boolean> {
  try {
    const tx = db.transaction(STORE_SETTINGS, "readonly")
    tx.objectStore(STORE_SETTINGS).get("healthcheck")
    return await new Promise((resolve) => {
      let settled = false
      const timeoutId = setTimeout(() => finish(false), 3000)
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve(ok)
      }
      tx.oncomplete = () => finish(true)
      tx.onerror = () => finish(false)
      tx.onabort = () => finish(false)
    })
  } catch {
    return false
  }
}

// 获取或生成设备ID
function getDeviceId(): string {
  if (deviceId) return deviceId
  deviceId = localStorage.getItem("neutab_device_id")
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem("neutab_device_id", deviceId)
  }
  return deviceId
}

// 打开数据库
export async function openDB(): Promise<IDBDatabase> {
  // 检查现有连接是否仍然有效
  if (dbInstance) {
    const healthy = await isConnectionHealthy(dbInstance)
    if (healthy) {
      return dbInstance
    }
    try {
      dbInstance.close()
    } catch {
      // ignore
    }
    console.warn("[IndexedDB] Cached connection invalid, reopening")
    dbInstance = null
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      dbInstance = null
      console.error("[IndexedDB] Failed to open database:", request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      dbInstance = request.result

      // 监听数据库意外关闭事件
      dbInstance.onclose = () => {
        console.warn("[IndexedDB] Database closed unexpectedly")
        dbInstance = null
      }

      // 监听版本变更（另一个标签页升级了数据库）
      dbInstance.onversionchange = () => {
        console.warn("[IndexedDB] Database version changed, closing connection")
        dbInstance?.close()
        dbInstance = null
      }

      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // 创建分组存储
      if (!db.objectStoreNames.contains(STORE_GROUPS)) {
        db.createObjectStore(STORE_GROUPS, { keyPath: "id" })
      }

      // 创建图标存储
      if (!db.objectStoreNames.contains(STORE_ICONS)) {
        db.createObjectStore(STORE_ICONS, { keyPath: "id" })
      }

      // 创建设置存储
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" })
      }
    }
  })
}

// 写入分组数据
export async function putGroups<T>(data: T): Promise<void> {
  try {
    const db = await openDB()
    const record: DataRecord<T> = {
      data,
      timestamp: Date.now(),
      deviceId: getDeviceId()
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_GROUPS, "readwrite")
      const store = tx.objectStore(STORE_GROUPS)
      const request = store.put({ id: "main", ...record })

      request.onsuccess = () => resolve()
      request.onerror = () => {
        handleTransactionError("putGroups request", request.error)
        reject(request.error)
      }
      tx.onerror = () => {
        handleTransactionError("putGroups transaction", tx.error)
        reject(tx.error)
      }
      tx.onabort = () => {
        dbInstance = null
        reject(new Error("Transaction aborted"))
      }
    })
  } catch (error) {
    console.error("[IndexedDB] putGroups failed:", error)
    throw error
  }
}

// 读取分组数据
export async function getGroups<T>(): Promise<DataRecord<T> | null> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_GROUPS, "readonly")
      const store = tx.objectStore(STORE_GROUPS)
      const request = store.get("main")

      request.onsuccess = () => {
        const result = request.result
        if (result) {
          resolve({ data: result.data, timestamp: result.timestamp, deviceId: result.deviceId })
        } else {
          resolve(null)
        }
      }
      request.onerror = () => {
        handleTransactionError("getGroups request", request.error)
        reject(request.error)
      }
      tx.onerror = () => {
        handleTransactionError("getGroups transaction", tx.error)
        reject(tx.error)
      }
    })
  } catch (error) {
    console.error("[IndexedDB] getGroups failed:", error)
    return null
  }
}

// 写入图标
export async function putIcon(iconId: string, base64: string): Promise<void> {
  try {
    const db = await openDB()

    // 检查存储配额（如果API支持）
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()
        const usage = estimate.usage || 0
        const quota = estimate.quota || Infinity

        if (usage / quota > 0.9) {
          console.warn(`[IndexedDB] Storage quota nearly full: ${(usage / quota * 100).toFixed(1)}% (${(usage / 1024 / 1024).toFixed(2)}MB / ${(quota / 1024 / 1024).toFixed(2)}MB)`)
        }
      } catch (e) {
        // 配额检测失败不阻塞流程
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ICONS, "readwrite")
      const store = tx.objectStore(STORE_ICONS)
      const request = store.put({ id: iconId, data: base64, timestamp: Date.now() })

      request.onsuccess = () => resolve()
      request.onerror = () => {
        if (request.error?.name === "QuotaExceededError") {
          console.error("[IndexedDB] Quota exceeded while saving icon")
        }
        handleTransactionError("putIcon request", request.error)
        reject(request.error)
      }
      tx.onerror = () => {
        handleTransactionError("putIcon transaction", tx.error)
        reject(tx.error)
      }
      tx.onabort = () => {
        dbInstance = null
        reject(new Error("Transaction aborted"))
      }
    })
  } catch (error) {
    console.error("[IndexedDB] putIcon failed:", error)
    throw error
  }
}

// 读取图标
export async function getIcon(iconId: string): Promise<string | null> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ICONS, "readonly")
      const store = tx.objectStore(STORE_ICONS)
      const request = store.get(iconId)

      request.onsuccess = () => resolve(request.result?.data || null)
      request.onerror = () => {
        handleTransactionError("getIcon request", request.error)
        reject(request.error)
      }
      tx.onerror = () => {
        handleTransactionError("getIcon transaction", tx.error)
        reject(tx.error)
      }
    })
  } catch (error) {
    console.error("[IndexedDB] getIcon failed:", error)
    return null
  }
}

// 删除图标
export async function deleteIcon(iconId: string): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ICONS, "readwrite")
      const store = tx.objectStore(STORE_ICONS)
      const request = store.delete(iconId)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        handleTransactionError("deleteIcon request", request.error)
        reject(request.error)
      }
      tx.onerror = () => {
        handleTransactionError("deleteIcon transaction", tx.error)
        reject(tx.error)
      }
      tx.onabort = () => {
        dbInstance = null
        reject(new Error("Transaction aborted"))
      }
    })
  } catch (error) {
    console.error("[IndexedDB] deleteIcon failed:", error)
    // 删除失败不应阻塞流程
  }
}

// 写入设置
export async function putSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite")
    const store = tx.objectStore(STORE_SETTINGS)
    const request = store.put({ key, value, timestamp: Date.now() })

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// 读取设置
export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readonly")
    const store = tx.objectStore(STORE_SETTINGS)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result?.value || null)
    request.onerror = () => reject(request.error)
  })
}
