const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const http = require("node:http")
const { spawn } = require("node:child_process")
const { once } = require("node:events")
const { createClient } = require("redis")

async function main() {
  if (!process.env.TEST_REDIS_URL) throw new Error("TEST_REDIS_URL must name a disposable empty database")
  const redis = createClient({ url: process.env.TEST_REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } })
  redis.on("error", () => {})
  await redis.connect()
  if (await redis.dbSize() !== 0) {
    await redis.quit()
    throw new Error("Fixture requires an empty disposable Redis database")
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "florayn-next-cache-"))
  const state = { content: "v1", stock: "v1", plain: "v1", products: "v1", contact: "v1" }
  const counts = { content: 0, stock: 0, plain: 0, products: 0, contact: 0 }
  const mock = http.createServer((req, res) => {
    const kind = req.url === "/store/contact-settings" ? "contact" : req.url.slice(1)
    counts[kind] = (counts[kind] || 0) + 1
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(kind === "contact" ? { settings: { title: state.contact } } : { value: state[kind] || "missing" }))
  })
  mock.listen(0, "127.0.0.1")
  await once(mock, "listening")
  const dataUrl = `http://127.0.0.1:${mock.address().port}`
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", STOREFRONT_REDIS_URL: process.env.TEST_REDIS_URL, REVALIDATE_SECRET: "isolated-test-secret", FIXTURE_DATA_URL: dataUrl, NEXT_PUBLIC_MEDUSA_BACKEND_URL: dataUrl, NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_local_fixture_only" }
  const cli = require.resolve("next/dist/bin/next")
  let child
  let output = ""
  const start = (args, extraEnv = {}) => {
    output = ""
    child = spawn(process.execPath, [cli, ...args], { cwd: directory, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.on("data", (part) => { output += part })
    child.stderr.on("data", (part) => { output += part })
    return child
  }
  const stop = async () => {
    if (!child || child.exitCode != null || child.signalCode != null) return
    const current = child
    const done = once(current, "exit")
    current.kill("SIGTERM")
    const timer = setTimeout(() => current.kill("SIGKILL"), 3000)
    await done
    clearTimeout(timer)
    child = undefined
  }
  const write = async (filename, content) => {
    const target = path.join(directory, filename)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  const sourceRoot = path.resolve(__dirname, "..")
  try {
    await fs.symlink(path.dirname(path.dirname(require.resolve("next/package.json"))), path.join(directory, "node_modules"), "dir")
    for (const filename of ["cache-handler.js", "cache-codec.js", "src/lib/revalidation.ts", "src/lib/contact.ts", "src/app/api/revalidate/route.ts"]) {
      await write(filename, await fs.readFile(path.join(sourceRoot, filename)))
    }
    await write("package.json", JSON.stringify({ name: "florayn-next-cache-fixture", private: true, dependencies: { next: "15.5.25", react: "19.2.0", "react-dom": "19.2.0" } }))
    await write("next.config.js", 'module.exports={trailingSlash:true,cacheHandler:require.resolve("./cache-handler.js"),experimental:{cpus:1},typescript:{ignoreBuildErrors:true},eslint:{ignoreDuringBuilds:true}}')
    await write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", allowJs: true, skipLibCheck: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", jsx: "preserve", paths: { "@/*": ["./src/*"] } }, include: ["**/*.ts", "**/*.tsx"] }))
    await write("src/app/layout.tsx", 'export default function Layout({children}) { return <html><body>{children}</body></html> }')
    await write("src/app/page.tsx", 'export default function Home() { return <main>ready</main> }')
    await write("src/app/contact/page.tsx", 'import {getContactSettings} from "@/lib/contact"; export const revalidate=60; export async function generateMetadata(){const settings=await getContactSettings();return {title:settings.title}}; export default async function Page(){const settings=await getContactSettings();return <main data-value={settings.title}>{settings.title}</main>}')
    await write("src/app/[kind]/page.tsx", 'export const revalidate=3600; export function generateStaticParams(){return []}; export default async function Page({params}) { const {kind}=await params; const response=await fetch(process.env.FIXTURE_DATA_URL+"/"+kind,{next:{revalidate:3600,...(kind==="plain"?{}:{tags:[kind]})}}); const data=await response.json(); return <main data-value={data.value}>{kind+":"+data.value}</main> }')
    let timer = setTimeout(() => child?.kill("SIGKILL"), 150000)
    let result = await once(start(["build"]), "exit")
    clearTimeout(timer)
    if (result[0] !== 0) throw new Error("Fixture build failed: " + output.slice(-5000))
    console.log(JSON.stringify({ stage: "build", nextVersion: require("next/package.json").version, ok: true }))
    const port = 19080
    const base = `http://127.0.0.1:${port}`
    const ready = async () => {
      for (let i = 0; i < 100; i++) {
        if (child.exitCode != null || child.signalCode != null) throw new Error("Fixture server exited: " + output.slice(-3000))
        try { if ((await fetch(base + "/", { signal: AbortSignal.timeout(1000) })).ok) return } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error("Fixture server did not become ready")
    }
    const page = async (name) => {
      const response = await fetch(`${base}/${name}/`, { signal: AbortSignal.timeout(15000) })
      assert.equal(response.status, 200)
      const text = await response.text()
      return { value: text.match(/data-value="([^"]+)"/)?.[1], cache: response.headers.get("x-nextjs-cache") }
    }
    const invalidate = async (body) => {
      const response = await fetch(base + "/api/revalidate/", { method: "POST", headers: { "content-type": "application/json", "x-revalidate-secret": "isolated-test-secret" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      return { status: response.status, body: await response.json() }
    }
    start(["start", "-p", String(port)])
    await ready()
    assert.equal((await page("content")).value, "v1")
    assert.equal((await page("stock")).value, "v1")
    assert.equal((await page("plain")).value, "v1")
    assert.equal((await page("products")).value, "v1")
    assert.equal((await page("contact")).value, "v1")
    const beforeContact = { ...counts }
    state.contact = "v2"
    assert.equal((await page("contact")).value, "v1")
    assert.equal((await invalidate({ tags: ["content:contact"] })).status, 200)
    const refreshedContact = await page("contact")
    assert.equal(refreshedContact.value, "v2")
    assert.equal((await page("content")).value, "v1")
    assert.equal((await page("stock")).value, "v1")
    assert.equal((await page("products")).value, "v1")
    assert.equal(counts.contact, beforeContact.contact + 1, "metadata and page share one fresh contact read")
    for (const kind of ["content", "stock", "products"]) assert.equal(counts[kind], beforeContact[kind], `${kind} remains cached after contact-only invalidation`)
    console.log(JSON.stringify({ stage: "contact-scoped-cache", refreshed: refreshedContact, backendReads: counts, unrelatedDomainsRetained: true }))
    state.content = state.stock = state.plain = "v2"
    const warm = await page("content")
    assert.equal(warm.value, "v1")
    const stockBefore = counts.stock
    assert.equal((await invalidate({ tags: ["content"] })).status, 200)
    const refreshed = await page("content")
    const unrelated = await page("stock")
    assert.equal(refreshed.value, "v2")
    assert.equal(unrelated.value, "v1")
    assert.equal(counts.stock, stockBefore)
    assert.equal((await page("plain")).value, "v1")
    assert.equal((await invalidate({ paths: ["/plain/"] })).status, 200)
    const soft = await page("plain")
    assert.equal(soft.value, "v2")
    assert.equal((await invalidate({})).status, 400)
    console.log(JSON.stringify({ stage: "next-native-cache", warm, refreshed, unrelated, soft, backendReads: counts, targetedInvalidation: true, softTagInvalidation: true }))
    await stop()
    start(["start", "-p", String(port)], { STOREFRONT_REDIS_URL: "redis://127.0.0.1:6399/15" })
    await ready()
    const failed = await invalidate({ tags: ["content"] })
    assert.equal(failed.status, 503)
    console.log(JSON.stringify({ stage: "unavailable-cache", status: failed.status, ok: true }))
  } finally {
    await stop()
    await new Promise((resolve) => mock.close(resolve))
    let cursor = 0
    do {
      const result = await redis.scan(cursor, { MATCH: "florayn:sf:*", COUNT: 200 })
      cursor = result.cursor
      if (result.keys.length) await redis.unlink(result.keys)
    } while (cursor !== 0)
    await redis.quit()
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
