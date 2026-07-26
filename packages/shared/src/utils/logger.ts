const isDev = (() => {
  try {
    const env = (import.meta as { env?: { DEV?: boolean } })?.env
    if (env && typeof env.DEV === "boolean") return env.DEV
  } catch {
    // ignore
  }

  try {
    const p = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process
    const nodeEnv = p?.env?.NODE_ENV
    if (typeof nodeEnv === "string") return nodeEnv !== "production"
  } catch {
    // ignore
  }

  return false
})()

export const logger = {
  debug: (...args: unknown[]) => isDev && console.log("[Debug]", ...args),
  warn: (...args: unknown[]) => console.warn("[Warn]", ...args),
  error: (...args: unknown[]) => console.error("[Error]", ...args)
}
