import { describe, expect, it } from "vitest"
import { normalizeEngines, normalizeGroups } from "@neutab/shared/utils/importNormalization"

describe("normalizeGroups", () => {
  it("非数组输入返回 null", () => {
    expect(normalizeGroups(undefined)).toBeNull()
    expect(normalizeGroups({})).toBeNull()
    expect(normalizeGroups("[]")).toBeNull()
  })

  it("清洗 app 的 URL 与名称,丢弃无有效 URL 的 app", () => {
    const groups = normalizeGroups([
      {
        id: "g1",
        name: "<b>组</b>",
        apps: [
          { id: "a1", name: "OK", url: "example.com" },
          { id: "a2", name: "XSS", url: "javascript:alert(1)" },
          { id: "a3", name: "empty", url: "" }
        ]
      }
    ])
    expect(groups).toHaveLength(1)
    expect(groups?.[0].name).toBe("b组/b")
    expect(groups?.[0].apps).toHaveLength(1)
    expect(groups?.[0].apps[0].url).toBe("https://example.com/")
  })

  it("customIcon 拒绝 data: URL(防大体积注入),接受 https", () => {
    const groups = normalizeGroups([
      {
        id: "g",
        name: "g",
        apps: [
          { id: "a", name: "a", url: "https://a.com", customIcon: "data:image/png;base64,x" },
          { id: "b", name: "b", url: "https://b.com", customIcon: "cdn.com/icon.png" }
        ]
      }
    ])
    expect(groups?.[0].apps[0].customIcon).toBeUndefined()
    expect(groups?.[0].apps[1].customIcon).toBe("https://cdn.com/icon.png")
  })

  it("internalUrl 允许 chrome:// 但拒绝危险协议", () => {
    const groups = normalizeGroups([
      {
        id: "g",
        name: "g",
        apps: [
          { id: "a", name: "a", url: "", internalUrl: "chrome://extensions" },
          { id: "b", name: "b", url: "", internalUrl: "javascript:alert(1)" }
        ]
      }
    ])
    // a 保留(有合法 internalUrl),b 被丢弃(两个 URL 都无效)
    expect(groups?.[0].apps).toHaveLength(1)
    expect(groups?.[0].apps[0].internalUrl).toContain("chrome://")
  })

  it("保留空字符串分组名,缺失名称时生成默认名", () => {
    const groups = normalizeGroups([
      { id: "1", name: "", apps: [] },
      { id: "2", apps: [] }
    ])
    expect(groups?.[0].name).toBe("")
    expect(groups?.[1].name).not.toBe("")
  })
})

describe("normalizeEngines", () => {
  it("非数组返回 null,空结果返回 null", () => {
    expect(normalizeEngines(null)).toBeNull()
    expect(normalizeEngines([{ name: "", url: "" }])).toBeNull()
  })

  it("保留 %s 占位符", () => {
    const engines = normalizeEngines([
      { id: "g", name: "Google", url: "https://google.com/search?q=%s" }
    ])
    expect(engines?.[0].url).toContain("%s")
  })

  it("丢弃非法 URL 的引擎", () => {
    const engines = normalizeEngines([
      { id: "bad", name: "Bad", url: "javascript:alert(1)" },
      { id: "ok", name: "OK", url: "https://ok.com/?q=%s" }
    ])
    expect(engines).toHaveLength(1)
    expect(engines?.[0].id).toBe("ok")
  })
})
