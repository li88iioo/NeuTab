import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const serverDir = fileURLToPath(new URL("../webserver/server/", import.meta.url))
const serverRequire = createRequire(path.join(serverDir, "package.json"))
const authCode = randomBytes(24).toString("hex")
const html = "<!doctype html><html><body>NeuTab integration test</body></html>"

let tempDir: string | undefined
let server: ChildProcess | undefined
let baseUrl: string
let token: string

async function availablePort(): Promise<number> {
  const listener = createServer()
  return new Promise((resolve, reject) => {
    listener.once("error", reject)
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address()
      if (!address || typeof address === "string") {
        listener.close(() => reject(new Error("无法获取测试服务器端口")))
        return
      }
      listener.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function request(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(new URL(url, baseUrl), {
    ...options,
    signal: AbortSignal.timeout(5000)
  })
}

function authorizedHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function post(url: string, value: unknown): Promise<Response> {
  return request(url, {
    method: "POST",
    headers: { ...authorizedHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(value)
  })
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const child = server
  await new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => child.kill("SIGKILL"), 1000)
    child.once("close", () => {
      clearTimeout(forceKill)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

describe("Web 服务器依赖升级兼容性", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "neutab-server-test-"))
    const clientDist = path.join(tempDir, "client")
    await mkdir(clientDist)
    await writeFile(path.join(clientDist, "index.html"), html)
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`

    server = spawn(process.execPath, [
      "--import", serverRequire.resolve("tsx"), path.join(serverDir, "src/index.ts")
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        AUTH_CODE: authCode,
        JWT_SECRET: randomBytes(32).toString("hex"),
        ALLOW_LEGACY_AUTH_CODE: "0",
        TRUST_PROXY: "0",
        DATA_DIR: path.join(tempDir, "data"),
        CLIENT_DIST_DIR: clientDist
      },
      stdio: ["ignore", "pipe", "pipe"]
    })

    const child = server
    await new Promise<void>((resolve, reject) => {
      let output = ""
      const timeout = setTimeout(() => {
        reject(new Error(`测试服务器启动超时：\n${output}`))
      }, 15_000)
      const onOutput = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16_384)
        if (output.includes("NeuTab server running on")) {
          clearTimeout(timeout)
          resolve()
        }
      }
      child.stdout?.on("data", onOutput)
      child.stderr?.on("data", onOutput)
      child.once("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once("exit", (code, signal) => {
        clearTimeout(timeout)
        reject(new Error(`测试服务器退出（${code ?? signal}）：\n${output}`))
      })
    })

    const response = await post("/api/auth/login", { authCode })
    expect(response.status).toBe(200)
    const result = await response.json() as { token: string }
    expect(result.token).toEqual(expect.any(String))
    token = result.token
  }, 20_000)

  afterAll(async () => {
    try {
      await stopServer()
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("启动后健康检查可用", async () => {
    const response = await request("/api/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it.each(["/", "/settings/theme"])("SPA 路由 %s 返回首页", async (url) => {
    const response = await request(url)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/html")
    expect(await response.text()).toBe(html)
  })

  it("未知 API 返回 JSON 404", async () => {
    const response = await request("/api/not-found/nested")
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
  })

  it("存储接口拒绝缺失或无效的凭据", async () => {
    const missing = await request("/api/storage/all")
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ error: "Unauthorized" })
    const invalid = await request("/api/storage/all", {
      headers: { Authorization: "Bearer invalid-token" }
    })
    expect(invalid.status).toBe(401)
  })

  it("登录校验访问码并签发 JWT 和 httpOnly 会话 cookie", async () => {
    const invalid = await post("/api/auth/login", { authCode: "wrong-code" })
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({ code: "INVALID_AUTH_CODE" })

    const valid = await post("/api/auth/login", { authCode })
    expect(valid.status).toBe(200)
    expect(await valid.json()).toMatchObject({ token: expect.any(String) })
    const cookie = valid.headers.get("Set-Cookie")
    expect(cookie).toContain("neutab_token=")
    expect(cookie).toContain("HttpOnly")

    const session = await request("/api/auth/session", {
      headers: { Cookie: cookie!.split(";")[0] }
    })
    expect(await session.json()).toEqual({ authenticated: true })
  })

  it("授权后可通过 SQLite 写入、读取、批量更新和删除", async () => {
    const key = "dependencyUpgrade"
    const value = { themeMode: "dark", items: [1, "two"] }
    const stored = await post("/api/storage/set", { key, value })
    expect(stored.status).toBe(200)
    expect(await stored.json()).toEqual({ success: true })

    const read = await request(`/api/storage/get/${key}`, {
      headers: authorizedHeaders()
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ found: true, value })

    const updated = await post("/api/storage/setMany", { items: { [key]: false } })
    expect(updated.status).toBe(200)
    const many = await post("/api/storage/getMany", { keys: [key, "missingKey"] })
    expect(many.status).toBe(200)
    expect(await many.json()).toEqual({ items: { [key]: false }, missing: ["missingKey"] })

    const removed = await post("/api/storage/remove", { key })
    expect(removed.status).toBe(200)
    const missing = await request(`/api/storage/get/${key}`, {
      headers: authorizedHeaders()
    })
    expect(await missing.json()).toEqual({ found: false, value: null })
  })

  it.each([
    "/api/auth/login",
    "/api/storage/getMany",
    "/api/storage/set",
    "/api/storage/setMany",
    "/api/storage/remove",
    "/api/icons/upload"
  ])("空请求体 %s 返回客户端错误", async (url) => {
    for (const contentType of [undefined, "application/json"]) {
      const headers = authorizedHeaders()
      if (contentType) headers["Content-Type"] = contentType
      const response = await request(url, { method: "POST", headers })
      expect(response.status).toBe(url === "/api/auth/login" ? 401 : 400)
      expect(await response.json()).toMatchObject({ error: expect.any(String) })
    }
  })
})
