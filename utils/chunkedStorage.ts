/**
 * 分片 Sync Storage 工具
 *
 * 解决 Chrome Sync Storage 8KB 单项限制问题
 * 通过分片 + LZ压缩，支持同步 200+ 网站数据到云端
 *
 * 使用场景：
 * - 主存储使用扩展的 local 区域（5MB 限制，足够本地使用）
 * - 启用云同步时，使用此工具将大对象分片写入 sync 区域
 */

import { Storage } from "@plasmohq/storage"
import LZString from "lz-string"
import { logger } from "@neutab/shared/utils/logger"

// Chrome sync 的单项配额通常约为 8KB，但配额统计单位是“字节”（BYTES），不是 JS 字符串的 length。
//
// 注意：
// - `string.length` 是 UTF-16 code unit 数量，不等于序列化后的字节数。
// - LZString.compressToUTF16 可能产生大量非 ASCII 字符；在 UTF-8 序列化后往往会占 2~3 字节/字符。
//   因此按 `string.length` 切片，仍可能触发 QUOTA_BYTES_PER_ITEM 超限。
//
// 结论：这里使用 TextEncoder（UTF-8）测量“key/value 的序列化字节数”，并预留安全边际后再切片。
const SYNC_QUOTA_BYTES_PER_ITEM_FALLBACK = 8192
const SYNC_QUOTA_SAFETY_MARGIN_BYTES = 384

/**
 * 估算字符串按 UTF-8 编码后的字节长度
 * - 浏览器（含扩展页面）通常提供 TextEncoder。
 * - 若无 TextEncoder，则回退使用 Blob 的 size。
 */
const utf8ByteLength = (s: string): number => {
  try {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(s).length
    }
    // 回退方案：Blob 在浏览器中也可用于测量字节大小。
    if (typeof Blob !== "undefined") {
      return new Blob([s]).size
    }
  } catch {
    // 忽略，继续走最后兜底
  }
  // 最终兜底：按 UTF-16 code unit * 2 估算（不精确，但不会崩）。
  return s.length * 2
}

/**
 * 估算单个 sync 项（key/value）写入时的字节占用
 * Chrome 的配额以“序列化后的字节数”为准，这里近似为：
 * - key 的 UTF-8 字节数
 * - value 经过 JSON.stringify 后的 UTF-8 字节数（包含引号/转义等开销）
 */
const estimateSyncItemBytes = (key: string, value: unknown): number => {
  return utf8ByteLength(key) + utf8ByteLength(JSON.stringify(value))
}

const getSyncQuotaBytesPerItem = (): number => {
  try {
    // 尽量读取运行时常量（Chromium 支持），读不到就用兜底默认值。
    const q = (globalThis as any)?.chrome?.storage?.sync?.QUOTA_BYTES_PER_ITEM
    if (typeof q === "number" && Number.isFinite(q) && q > 0) return q
  } catch {
    // ignore
  }
  return SYNC_QUOTA_BYTES_PER_ITEM_FALLBACK
}
const CHUNK_PREFIX = "_chunk_"

type ChunkMeta = {
  __chunked?: boolean
  __compressed?: boolean
  __chunkCount?: number
  /** 可选 revision：用于近似“事务式”更新，避免先清旧数据导致的数据丢失窗口。 */
  __rev?: string
  data?: string
}

const makeChunkKey = (key: string, index: number, rev?: string) => {
  return rev ? `${key}${CHUNK_PREFIX}${rev}_${index}` : `${key}${CHUNK_PREFIX}${index}`
}

const getMeta = async (storage: Storage, key: string): Promise<ChunkMeta | null> => {
  const raw = await storage.get<any>(key)
  if (!raw) return null
  // 兼容旧格式：老版本可能直接存数组/对象，没有 meta 字段。
  if (raw.__chunked === undefined && raw.__compressed === undefined) return raw as ChunkMeta
  return raw as ChunkMeta
}

const removeChunksForMeta = async (storage: Storage, key: string, meta: ChunkMeta | null) => {
  if (!meta || !meta.__chunked) return
  const count = meta.__chunkCount || 0
  const rev = meta.__rev
  const removePromises: Promise<void>[] = []
  for (let i = 0; i < count; i++) {
    removePromises.push(storage.remove(makeChunkKey(key, i, rev)))
  }
  await Promise.all(removePromises)
}

const makeRevision = (): string => {
  // 不需要密码学强度；只要“足够唯一”避免碰撞即可。
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 将大数据分片存储到 Chrome Sync Storage
 */
export async function setChunkedData<T>(
  storage: Storage,
  key: string,
  data: T,
  compress = true
): Promise<void> {
  const prevMeta = await getMeta(storage, key)

  // 序列化数据
  let serialized = JSON.stringify(data)

  // 压缩（可减少 60-80% 体积）
  if (compress) {
    serialized = LZString.compressToUTF16(serialized)
  }

  // 如果数据足够小，直接存储
  // 注意：我们实际存的是一个对象（meta + data），因此需要按真实的 key/value 序列化字节数估算。
  if (estimateSyncItemBytes(key, { __chunked: false, __compressed: compress, data: serialized }) <= getSyncQuotaBytesPerItem() - SYNC_QUOTA_SAFETY_MARGIN_BYTES) {
    await storage.set(key, {
      __chunked: false,
      __compressed: compress,
      data: serialized
    })
    // 新值写入成功后，再“尽力清理”旧的分片数据（不强保证，避免影响主流程）。
    await removeChunksForMeta(storage, key, prevMeta)
    return
  }

  // 分片存储
  const rev = makeRevision()
  const quotaBytes = getSyncQuotaBytesPerItem()
  const maxItemBytes = Math.max(1024, quotaBytes - SYNC_QUOTA_SAFETY_MARGIN_BYTES)

  // 构造符合“单项字节配额”的分片（同时考虑 key 长度与 JSON 序列化开销）。
  // - 使用 slice + 指数探测 + 二分查找，避免 O(n^2) 的字符串拼接
  // - 按 Unicode 码点边界切分，避免拆开 surrogate pair 导致非法 UTF-16
  const chunks: string[] = []

  const boundaries: number[] = []
  for (let i = 0; i < serialized.length;) {
    boundaries.push(i)
    const cp = serialized.codePointAt(i)
    i += cp && cp > 0xffff ? 2 : 1
  }
  boundaries.push(serialized.length)

  const fits = (chunkIndex: number, startBoundaryIndex: number, endBoundaryIndex: number): boolean => {
    const k = makeChunkKey(key, chunkIndex, rev)
    const start = boundaries[startBoundaryIndex]
    const end = boundaries[endBoundaryIndex]
    const slice = serialized.slice(start, end)
    return estimateSyncItemBytes(k, slice) <= maxItemBytes
  }

  let startBi = 0
  let chunkIndex = 0

  while (startBi < boundaries.length - 1) {
    // 必须保证推进：至少尝试塞进一个 Unicode 码点。
    if (!fits(chunkIndex, startBi, startBi + 1)) {
      // 理论上几乎不可能发生，但这里做防御，避免死循环。
      throw new Error(`[chunkedStorage] Single code point exceeds sync quota at chunk ${chunkIndex}`)
    }

    // 指数探测：快速找到“不再 fit 的上界”。
    let good = startBi + 1
    let step = 1024
    let probe = Math.min(boundaries.length - 1, startBi + step)

    while (probe > good && fits(chunkIndex, startBi, probe)) {
      good = probe
      step *= 2
      probe = Math.min(boundaries.length - 1, startBi + step)
      if (good === boundaries.length - 1) break
    }

    if (good === boundaries.length - 1) {
      // 剩余尾巴可以放进一个 chunk。
      const start = boundaries[startBi]
      chunks.push(serialized.slice(start))
      break
    }

    // 二分：在 (good, probe) 范围内找到“最大的仍然 fit 的结束点”。
    let lo = good + 1
    let hi = Math.max(lo, probe - 1)
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (fits(chunkIndex, startBi, mid)) {
        good = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    const start = boundaries[startBi]
    const end = boundaries[good]
    chunks.push(serialized.slice(start, end))
    startBi = good
    chunkIndex += 1
  }

  // 终极防御：如果仍然出现某个分片超过配额（理论上不该发生），
  // 则回退到“按长度切片”的旧策略，避免直接写入失败导致同步不可用。
  if (chunks.some((chunk, i) => estimateSyncItemBytes(makeChunkKey(key, i, rev), chunk) > maxItemBytes)) {
    logger.warn(`[chunkedStorage] 按字节切分仍超过配额，回退到按长度切片`)
    chunks.length = 0
    const FALLBACK_CHUNK_LEN = 3000
    for (let i = 0; i < serialized.length; i += FALLBACK_CHUNK_LEN) {
      chunks.push(serialized.slice(i, i + FALLBACK_CHUNK_LEN))
    }
  }

  // 先写入新 revision 的分片：若出现配额/IO 错误，旧数据保持不动（避免“写一半就丢数据”）。
  try {
    await Promise.all(chunks.map((chunk, index) => storage.set(makeChunkKey(key, index, rev), chunk)))
  } catch (e) {
    // 尽力清理已写入的一部分新分片（不强保证）。
    try {
      await Promise.all(chunks.map((_, index) => storage.remove(makeChunkKey(key, index, rev))))
    } catch {
      // ignore
    }
    throw e
  }

  // 存储元数据（指向新 revision）
  await storage.set(key, {
    __chunked: true,
    __compressed: compress,
    __chunkCount: chunks.length,
    __rev: rev
  })

  // meta 更新成功后，再清理旧 revision 的 chunks。
  await removeChunksForMeta(storage, key, prevMeta)
}

/**
 * 从 Chrome Storage 读取分片数据
 */
export async function getChunkedData<T>(
  storage: Storage,
  key: string
): Promise<T | null> {
  const meta = await getMeta(storage, key)

  if (!meta) {
    return null
  }

  // 兼容旧格式（未分片的原始数据）
  if (meta.__chunked === undefined && meta.__compressed === undefined) {
    // 旧格式：直接是数据数组
    return meta as unknown as T
  }

  let serialized: string

  if (meta.__chunked) {
    // 分片数据：并行读取所有分片
    const chunkCount = meta.__chunkCount || 0
    const chunkPromises: Promise<string | null | undefined>[] = []

    for (let i = 0; i < chunkCount; i++) {
      chunkPromises.push(storage.get(makeChunkKey(key, i, meta.__rev)))
    }

    const chunks = await Promise.all(chunkPromises)

    // 检查是否有缺失的分片
    if (chunks.some(c => c === null || c === undefined)) {
      logger.warn(`Missing chunks for key: ${key}`)
      return null
    }

    serialized = chunks.join("")
  } else {
    // 未分片数据
    serialized = meta.data || ""
  }

  // 解压
  if (meta.__compressed) {
    const decompressed = LZString.decompressFromUTF16(serialized)
    if (!decompressed) {
      logger.warn(`Decompression failed for key: ${key}`)
      return null
    }
    serialized = decompressed
  }

  try {
    return JSON.parse(serialized) as T
  } catch (e) {
    logger.error(`Parse error for key: ${key}`, e)
    return null
  }
}

/**
 * 清理指定 key 的所有分片
 */
export async function clearChunks(storage: Storage, key: string): Promise<void> {
  const meta = await getMeta(storage, key)
  await removeChunksForMeta(storage, key, meta)
  await storage.remove(key)
}

/**
 * 估算数据压缩后的大小（字节）
 */
export function estimateCompressedSize(data: unknown): number {
  const serialized = JSON.stringify(data)
  const compressed = LZString.compressToUTF16(serialized)
  // 压缩字符串最终会作为 JSON 字符串存入 sync（按 UTF-8 字节计费），因此这里按 UTF-8 字节测量。
  return utf8ByteLength(compressed)
}

/**
 * 估算需要多少个分片
 */
export function estimateChunkCount(data: unknown): number {
  const serialized = JSON.stringify(data)
  const compressed = LZString.compressToUTF16(serialized)
  const quotaBytes = getSyncQuotaBytesPerItem()
  const maxItemBytes = Math.max(1024, quotaBytes - SYNC_QUOTA_SAFETY_MARGIN_BYTES)

  // 按字节数粗略估算 chunk 数（忽略 key 开销），用于 UI/日志估算足够。
  const bytes = utf8ByteLength(compressed)
  return Math.ceil(bytes / maxItemBytes)
}
