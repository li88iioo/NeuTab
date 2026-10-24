import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)
const plasmoRequire = createRequire(require.resolve("plasmo/package.json"))
const configRequire = createRequire(plasmoRequire.resolve("@plasmohq/parcel-config/package.json"))
const parcelRequire = createRequire(configRequire.resolve("@parcel/config-default/package.json"))
const optimizerRequire = createRequire(parcelRequire.resolve("@parcel/optimizer-htmlnano/package.json"))
const vueRequire = createRequire(configRequire.resolve("@plasmohq/parcel-transformer-vue/package.json"))

describe("构建工具的隔离依赖", () => {
  it("Vite 的可选 esbuild 满足其 peer 约束且可转换 JSX", async () => {
    const viteRequire = createRequire(require.resolve("vite/package.json"))
    const esbuild = viteRequire("esbuild")
    const { satisfies } = plasmoRequire("semver")
    const range = require("vite/package.json").peerDependencies.esbuild
    expect(satisfies(esbuild.version, range)).toBe(true)
    const result = await esbuild.transform("const element = <div />", { loader: "jsx" })
    expect(result.code).toContain("React.createElement")
  })

  it("旧模板 renderer 可运行且不会替换应用的 React 19", async () => {
    const consolidate = vueRequire("@plasmohq/consolidate")
    expect(require("react/package.json").version).toMatch(/^19\./)
    const dir = await mkdtemp(path.join(tmpdir(), "neutab-template-test-"))
    try {
      const template = path.join(dir, "view.cjs")
      await writeFile(template, 'module.exports = function View(props) { return "Hello " + props.name }')
      expect(await consolidate.react(template, { name: "NeuTab" })).toBe("Hello NeuTab")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("SVG 优化保留无障碍信息和跨图标引用", async () => {
    const config = JSON.parse(await readFile(new URL("../.htmlnanorc.json", import.meta.url), "utf8"))
    const html = '<html><body><svg role="img" aria-labelledby="icon-title" viewBox="0 0 24 24"><title id="icon-title">Icon title</title><desc>Icon description</desc><path id="shared-path" d="M0 0h24v24H0z"/></svg><svg><use href="#shared-path"/></svg></body></html>'
    const result = await optimizerRequire("htmlnano").process(html, {
      ...config,
      minifyJs: false,
      minifyCss: false
    })
    expect(result.html).toContain('role="img"')
    expect(result.html).toContain('aria-labelledby="icon-title"')
    expect(result.html).toContain('<title id="icon-title">Icon title</title>')
    expect(result.html).toContain("<desc>Icon description</desc>")
    expect(result.html).toContain('id="shared-path"')
    expect(result.html).toContain('href="#shared-path"')
  })
})
