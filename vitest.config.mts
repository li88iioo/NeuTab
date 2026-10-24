import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@neutab/shared",
        replacement: fileURLToPath(new URL("./packages/shared/src", import.meta.url))
      },
      // Plasmo 风格的 ~ 前缀(无斜杠),如 ~utils/chunkedStorage
      {
        find: /^~(.*)/,
        replacement: fileURLToPath(new URL(".", import.meta.url)) + "$1"
      }
    ]
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
})
