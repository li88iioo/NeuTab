import { describe, expect, it } from "vitest"
import {
  isAllowedNavigationUrl,
  isHttpUrl,
  isInternalUrl,
  sanitizeHexColor,
  sanitizeInternalUrl,
  sanitizeName,
  sanitizeUrl
} from "@neutab/shared/utils/validation"

describe("sanitizeUrl", () => {
  it("补全缺失的协议头", () => {
    expect(sanitizeUrl("github.com")).toBe("https://github.com/")
    expect(sanitizeUrl("example.com/path")).toBe("https://example.com/path")
    expect(sanitizeUrl("sub.domain.com:8080")).toBe("https://sub.domain.com:8080/")
  })

  it("不误伤以 http 开头的域名", () => {
    expect(sanitizeUrl("httpbin.org")).toBe("https://httpbin.org/")
  })

  it("保留已有的 http/https 协议", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com/")
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com/")
  })

  it("拒绝可执行协议", () => {
    expect(() => sanitizeUrl("javascript:alert(1)")).toThrow()
    expect(() => sanitizeUrl("data:text/html,<script>alert(1)</script>")).toThrow()
    expect(() => sanitizeUrl("vbscript:msgbox(1)")).toThrow()
    expect(() => sanitizeUrl("file:///etc/passwd")).toThrow()
  })

  it("拒绝大小写混淆的协议", () => {
    expect(() => sanitizeUrl("JavaScript:alert(1)")).toThrow()
    expect(() => sanitizeUrl("JAVASCRIPT:alert(1)")).toThrow()
  })

  it("拒绝空输入", () => {
    expect(() => sanitizeUrl("")).toThrow()
    expect(() => sanitizeUrl("   ")).toThrow()
  })

  it("处理 unicode 域名和 IP 地址", () => {
    expect(sanitizeUrl("192.168.1.1")).toBe("https://192.168.1.1/")
    // punycode 转换由 URL 标准处理
    expect(sanitizeUrl("例え.jp")).toContain("https://")
  })
})

describe("sanitizeInternalUrl", () => {
  it("允许浏览器内部协议", () => {
    expect(sanitizeInternalUrl("chrome://extensions")).toContain("chrome://")
    expect(sanitizeInternalUrl("about:blank")).toBe("about:blank")
  })

  it("允许内网 http 地址", () => {
    expect(sanitizeInternalUrl("http://192.168.1.100:8080")).toBe("http://192.168.1.100:8080/")
  })

  it("无协议头按 https 处理", () => {
    expect(sanitizeInternalUrl("nas.local")).toBe("https://nas.local/")
  })

  it("拒绝可执行协议", () => {
    expect(() => sanitizeInternalUrl("javascript:alert(1)")).toThrow()
    expect(() => sanitizeInternalUrl("data:text/html,x")).toThrow()
  })
})

describe("isHttpUrl / isInternalUrl / isAllowedNavigationUrl", () => {
  it("识别 http/https", () => {
    expect(isHttpUrl("https://a.com")).toBe(true)
    expect(isHttpUrl("ftp://a.com")).toBe(false)
    expect(isHttpUrl("not a url")).toBe(false)
  })

  it("识别内部协议", () => {
    expect(isInternalUrl("chrome://settings")).toBe(true)
    expect(isInternalUrl("javascript:alert(1)")).toBe(false)
  })

  it("导航白名单拦截危险协议", () => {
    expect(isAllowedNavigationUrl("https://a.com")).toBe(true)
    expect(isAllowedNavigationUrl("chrome://settings")).toBe(true)
    expect(isAllowedNavigationUrl("javascript:alert(1)")).toBe(false)
    expect(isAllowedNavigationUrl("data:text/html,x")).toBe(false)
  })
})

describe("sanitizeName", () => {
  it("移除尖括号防注入", () => {
    expect(sanitizeName("<script>alert(1)</script>")).toBe("scriptalert(1)/script")
  })

  it("截断到 50 字符", () => {
    expect(sanitizeName("a".repeat(100))).toHaveLength(50)
  })

  it("保留空白名称(允许空分组名)", () => {
    expect(sanitizeName("  ")).toBe("  ")
    expect(sanitizeName("")).toBe("")
  })
})

describe("sanitizeHexColor", () => {
  it("接受合法 6 位色值", () => {
    expect(sanitizeHexColor("#aaBB99")).toBe("#aaBB99")
  })

  it("展开 3 位色值", () => {
    expect(sanitizeHexColor("#abc")).toBe("#aabbcc")
  })

  it("非法值回退默认色", () => {
    expect(sanitizeHexColor("red")).toBe("#6c5ce7")
    expect(sanitizeHexColor("#12345")).toBe("#6c5ce7")
    expect(sanitizeHexColor("url(evil)")).toBe("#6c5ce7")
    expect(sanitizeHexColor(null as unknown as string)).toBe("#6c5ce7")
  })
})
