/**
 * Check that uploaded images are actually reachable at the public URL, and
 * that the products point at URLs that work.
 *
 *   node scripts/verify-r2.mjs
 */
import fs from "node:fs"
import path from "node:path"

const ENV = path.join(import.meta.dirname, "..", "apps", "backend", ".env")
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const base = (process.env.IMAGE_BASE_URL ?? process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "")
if (!base) {
  console.error("No IMAGE_BASE_URL or R2_PUBLIC_URL set.")
  process.exit(1)
}

const manifestPath =
  process.env.IMAGE_MANIFEST ?? "C:/Users/Md Shamim/florayn-images/manifest.json"
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))

// A spread across families rather than the first few of one design.
const picks = []
const wanted = ["phone", "airpods", "watch", "card-wallet", "magsafe-wallet"]
for (const family of wanted) {
  for (const [key, product] of Object.entries(manifest.products)) {
    const paths = product.images[family]
    if (paths?.length) { picks.push({ family, key, rel: paths[0] }); break }
  }
}
// Plus a random handful, to catch a partial upload.
const all = Object.values(manifest.products).flatMap((p) => Object.values(p.images).flat())
for (let i = 0; i < 10; i++) {
  picks.push({ family: "random", key: "-", rel: all[Math.floor(Math.random() * all.length)] })
}

console.log(`Checking ${picks.length} objects at ${base}\n`)
let ok = 0, bad = 0
for (const pick of picks) {
  const url = `${base}/${pick.rel}`
  try {
    const res = await fetch(url, { method: "HEAD" })
    const type = res.headers.get("content-type") ?? "-"
    const len = res.headers.get("content-length") ?? "-"
    const cache = res.headers.get("cache-control") ?? "-"
    const good = res.ok && type.startsWith("image/")
    good ? ok++ : bad++
    console.log(
      `  ${good ? "ok " : "BAD"} ${String(res.status)}  ${type.padEnd(11)} ` +
      `${String(len).padStart(8)}  ${pick.family.padEnd(15)} ${pick.rel}`
    )
    if (good && !cache.includes("max-age")) console.log(`       note: cache-control is "${cache}"`)
  } catch (e) {
    bad++
    console.log(`  ERR      ${pick.rel}  ${e.message}`)
  }
}
console.log(`\n${ok} reachable, ${bad} not.`)
process.exit(bad ? 1 : 0)
