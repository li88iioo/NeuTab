const isDev = (() => {
  try {
    const env = (import.meta as any)?.env
    if (env && typeof env.DEV === "boolean") return env.DEV
  } catch {
    // ignore
  }

  try {
    const p = (globalThis as any).process
    const nodeEnv = p?.env?.NODE_ENV
    if (typeof nodeEnv === "string") return nodeEnv !== "production"
  } catch {
    // ignore
  }

  return false
})()

export const logger = {
  debug: (...args: any[]) => isDev && console.log("[Debug]", ...args),
  warn: (...args: any[]) => console.warn("[Warn]", ...args),
  error: (...args: any[]) => console.error("[Error]", ...args)
}
