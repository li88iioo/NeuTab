import { describe, expect, it } from "vitest"
import type { Storage } from "@plasmohq/storage"
import {
  clearChunks,
  estimateChunkCount,
  getChunkedData,
  setChunkedData
} from "~utils/chunkedStorage"

/** 内存版 Storage mock,行为对齐 @plasmohq/storage 的 get/set/remove 子集 */
const createMockStorage = () => {
  const map = new Map<string, unknown>()
  const storage = {
    get: async <T,>(key: string) => (map.has(key) ? (map.get(key) as T) : undefined),
    set: async (key: string, value: unknown) => {
      map.set(key, value)
    },
    remove: async (key: string) => {
      map.delete(key)
    }
  } as unknown as Storage
  return { storage, map }
}

/** 生成压缩率低的伪随机大数据,确保 LZ 压缩后仍超过单项配额、触发分片 */
const makeBigData = (items = 400) => {
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed
  }
  const randHex = (len: number) => {
    let s = ""
    while (s.length < len) s += rand().toString(16)
    return s.slice(0, len)
  }
  return Array.from({ length: items }, (_, i) => ({
    id: `id-${i}-${randHex(16)}`,
    name: `站点${i}-${randHex(24)}`,
    url: `https://example-${i}.com/${randHex(64)}?token=${randHex(32)}`
  }))
}

describe("chunkedStorage 往返", () => {
  it("小数据:压缩往返一致,不分片", async () => {
    const { storage, map } = createMockStorage()
    const data = { groups: [{ id: "1", name: "测试", apps: [] }] }
    await setChunkedData(storage, "k", data)
    expect(await getChunkedData(storage, "k")).toEqual(data)
    // 只有 meta 一个 key,没有分片
    expect([...map.keys()]).toEqual(["k"])
  })

  it("大数据:分片后往返一致", async () => {
    const { storage, map } = createMockStorage()
    const data = makeBigData()
    await setChunkedData(storage, "big", data)
    expect(await getChunkedData(storage, "big")).toEqual(data)
    expect(map.size).toBeGreaterThan(1)
  })

  it("大数据含 emoji(surrogate pair)不被切坏", async () => {
    const { storage } = createMockStorage()
    const data = Array.from({ length: 300 }, (_, i) => ({
      id: `${i}`,
      name: `🚀🎉😀日本語テスト${i}-${(i * 7919).toString(36)}`,
      url: `https://example-${i}.com/${(i * 31337).toString(36)}`
    }))
    // 不压缩,让原始 JSON(含 surrogate pair)直接参与切片
    await setChunkedData(storage, "emoji", data, false)
    expect(await getChunkedData(storage, "emoji")).toEqual(data)
  })

  it("不压缩模式往返一致", async () => {
    const { storage } = createMockStorage()
    const data = { a: 1, b: "中文", c: [1, 2, 3] }
    await setChunkedData(storage, "k", data, false)
    expect(await getChunkedData(storage, "k")).toEqual(data)
  })

  it("空数据往返", async () => {
    const { storage } = createMockStorage()
    await setChunkedData(storage, "k", [])
    expect(await getChunkedData(storage, "k")).toEqual([])
    await setChunkedData(storage, "k2", {})
    expect(await getChunkedData(storage, "k2")).toEqual({})
  })

  it("不存在的 key 返回 null", async () => {
    const { storage } = createMockStorage()
    expect(await getChunkedData(storage, "missing")).toBeNull()
  })

  it("覆盖写入后旧分片被清理", async () => {
    const { storage, map } = createMockStorage()
    await setChunkedData(storage, "k", makeBigData())
    expect(map.size).toBeGreaterThan(1)
    // 覆盖为小数据后,旧分片应被清掉
    await setChunkedData(storage, "k", { small: true })
    expect([...map.keys()]).toEqual(["k"])
    expect(await getChunkedData(storage, "k")).toEqual({ small: true })
  })

  it("分片缺失时返回 null 而不是坏数据", async () => {
    const { storage, map } = createMockStorage()
    await setChunkedData(storage, "k", makeBigData())
    // 删除一个分片模拟同步不完整
    const chunkKey = [...map.keys()].find((k) => k.includes("_chunk_"))
    expect(chunkKey).toBeDefined()
    map.delete(chunkKey!)
    expect(await getChunkedData(storage, "k")).toBeNull()
  })

  it("写入失败时旧数据保持可读(近似事务)", async () => {
    const { storage, map } = createMockStorage()
    const original = { keep: "me" }
    await setChunkedData(storage, "k", original)

    const big = makeBigData()
    // 让分片写入失败(meta key "k" 的写入不拦截,只拦分片)
    const originalSet = storage.set.bind(storage)
    ;(storage as unknown as { set: typeof storage.set }).set = async (key: string, value: unknown) => {
      if (key.includes("_chunk_")) throw new Error("quota exceeded")
      return originalSet(key, value)
    }
    await expect(setChunkedData(storage, "k", big)).rejects.toThrow()
    // 旧数据未被破坏
    ;(storage as unknown as { set: typeof storage.set }).set = originalSet
    expect(await getChunkedData(storage, "k")).toEqual(original)
    expect(map.get("k")).toBeDefined()
  })

  it("clearChunks 清空 meta 与所有分片", async () => {
    const { storage, map } = createMockStorage()
    await setChunkedData(storage, "k", makeBigData())
    await clearChunks(storage, "k")
    expect(map.size).toBe(0)
  })

  it("兼容旧格式(直接存数组)", async () => {
    const { storage, map } = createMockStorage()
    map.set("legacy", [{ id: "1" }])
    expect(await getChunkedData(storage, "legacy")).toEqual([{ id: "1" }])
  })
})

describe("estimateChunkCount", () => {
  it("小数据估算为 1 片", () => {
    expect(estimateChunkCount({ a: 1 })).toBe(1)
  })

  it("大数据估算多片", () => {
    expect(estimateChunkCount(makeBigData(2000))).toBeGreaterThan(1)
  })
})
