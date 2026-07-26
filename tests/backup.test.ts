import { describe, expect, it } from "vitest"
import { normalizeBackupImport, resolveBackupData } from "@neutab/shared/utils/backup"

describe("resolveBackupData", () => {
  it("v2 嵌套格式:展开 settings 并合并 customIcons", () => {
    const resolved = resolveBackupData({
      settings: { themeMode: "dark" },
      customIcons: { a: "data:image/png;base64,x" }
    })
    expect(resolved.themeMode).toBe("dark")
    expect(resolved.customIcons).toEqual({ a: "data:image/png;base64,x" })
  })

  it("v1 扁平格式:原样返回", () => {
    const raw = { themeMode: "light", showClock: true }
    expect(resolveBackupData(raw)).toBe(raw)
  })
})

describe("normalizeBackupImport", () => {
  it("兼容旧字段 darkMode → themeMode", () => {
    expect(normalizeBackupImport({ darkMode: true }, "zh").updates.themeMode).toBe("dark")
    expect(normalizeBackupImport({ darkMode: false }, "zh").updates.themeMode).toBe("light")
    expect(normalizeBackupImport({ darkMode: 1 }, "zh").updates.themeMode).toBe("dark")
  })

  it("拒绝非法 themeMode/visualTheme/language 值", () => {
    const r = normalizeBackupImport(
      { themeMode: "evil", visualTheme: "x", language: "fr" },
      "zh"
    )
    expect(r.updates.themeMode).toBeUndefined()
    expect(r.updates.visualTheme).toBeUndefined()
    expect(r.updates.language).toBeUndefined()
  })

  it("布尔字段接受 0/1 但拒绝其他类型", () => {
    const r = normalizeBackupImport(
      { showClock: 1, showSeconds: "yes", showSearchBar: false },
      "zh"
    )
    expect(r.updates.showClock).toBe(true)
    expect(r.updates.showSeconds).toBeUndefined()
    expect(r.updates.showSearchBar).toBe(false)
  })

  it("布局数值超界时被 clamp", () => {
    const r = normalizeBackupImport(
      { contentMaxWidth: 999999, iconBorderRadius: -50 },
      "zh"
    )
    expect(typeof r.updates.contentMaxWidth).toBe("number")
    expect(r.updates.contentMaxWidth as number).toBeLessThan(999999)
    expect(r.updates.iconBorderRadius as number).toBeGreaterThanOrEqual(0)
  })

  it("siteFavicon 拒绝非法 URL,保留 data:image 与合法 https", () => {
    expect(
      normalizeBackupImport({ siteFavicon: "javascript:alert(1)" }, "zh").updates.siteFavicon
    ).toBe("")
    expect(
      normalizeBackupImport({ siteFavicon: "data:image/png;base64,x" }, "zh").updates.siteFavicon
    ).toBe("data:image/png;base64,x")
    expect(
      normalizeBackupImport({ siteFavicon: "example.com/icon.png" }, "zh").updates.siteFavicon
    ).toBe("https://example.com/icon.png")
  })

  it("v1 quickLaunchApps 旧格式包装为默认分组", () => {
    const r = normalizeBackupImport(
      { quickLaunchApps: [{ id: "1", name: "A", url: "https://a.com" }] },
      "zh"
    )
    expect(r.groups).toHaveLength(1)
    expect(r.groups?.[0].id).toBe("default")
  })

  it("customIcons 过滤非 data:image 值", () => {
    const r = normalizeBackupImport(
      {
        settings: {},
        customIcons: {
          good: "data:image/png;base64,x",
          bad: "https://evil.com/x.png",
          worse: 123
        }
      },
      "zh"
    )
    expect(r.customIcons).toEqual({ good: "data:image/png;base64,x" })
  })

  it("currentEngine 指向不存在的引擎时回退到第一个", () => {
    const r = normalizeBackupImport(
      {
        searchEngines: [{ id: "bing", name: "Bing", url: "https://bing.com/search?q=%s" }],
        currentEngine: "nonexistent"
      },
      "zh"
    )
    expect(r.updates.currentEngine).toBe("bing")
  })

  it("空输入不崩溃", () => {
    const r = normalizeBackupImport({}, "zh")
    expect(r.updates).toEqual({})
    expect(r.groups).toBeUndefined()
    expect(r.customIcons).toBeUndefined()
  })
})
