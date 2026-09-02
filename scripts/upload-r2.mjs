/**
 * Upload the image tree to R2, preserving folder structure and setting
 * content-type from the extension.
 *
 * Credentials come from the environment - never from this file. Run it as:
 *   node upload-r2.mjs
 * with R2_* set, or with apps/backend/.env present.
 *
 * Resumable: an object already in the bucket with the same size is skipped, so
 * a rerun after an interruption only uploads what is missing.
 */
import fs from "node:fs"
import path from "node:path"
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"

const T = process.env.IMAGE_DIR ?? "C:/Users/Md Shamim/florayn-images"
const ENV = path.join(import.meta.dirname, "..", "apps", "backend", ".env")

// Load .env without adding a dependency.
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
const missing = ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
  .filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`)
  console.error(`Set them in ${ENV} (see apps/backend/.env.r2.template).`)
  process.exit(1)
}

const TYPES = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" }

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(webp|jpe?g|png)$/i.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(T)
let done = 0, skipped = 0, failed = 0, bytes = 0
const failures = []
const started = Date.now()

function report(final = false) {
  const line =
    `${done + skipped + failed}/${files.length}  uploaded ${done}  skipped ${skipped}  ` +
    `failed ${failed}  ${(bytes / 1048576).toFixed(1)} MB  ` +
    `${((Date.now() - started) / 1000).toFixed(0)}s` + (final ? "  DONE" : "")
  fs.writeFileSync(path.join(import.meta.dirname, "upload.progress"), line + "\n")
  if (!final) process.stdout.write(`\r${line}`)
}

async function one(file) {
  const key = path.relative(T, file).split(path.sep).join("/")
  const size = fs.statSync(file).size
  const ext = key.split(".").pop().toLowerCase()

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    if (head.ContentLength === size) { skipped++; return }
  } catch { /* not there, upload it */ }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: fs.readFileSync(file),
        ContentType: TYPES[ext] ?? "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      }))
      done++; bytes += size
      return
    } catch (e) {
      if (attempt === 3) {
        failed++
        failures.push({ key, error: String(e.message ?? e) })
        return
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
}

// The manifest travels with the images so the bucket is self-describing.
files.push(path.join(T, "manifest.json"))

const queue = [...files]
async function worker() {
  while (queue.length) {
    const f = queue.shift()
    if (f.endsWith("manifest.json")) {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: "manifest.json",
        Body: fs.readFileSync(f), ContentType: "application/json",
      })).then(() => done++).catch((e) => { failed++; failures.push({ key: "manifest.json", error: String(e.message) }) })
      continue
    }
    await one(f)
    if ((done + skipped + failed) % 25 === 0) report()
  }
}

await Promise.all(Array.from({ length: 8 }, worker))
report(true)
console.log()
if (failures.length) {
  fs.writeFileSync(path.join(import.meta.dirname, "upload-failures.json"), JSON.stringify(failures, null, 1))
  console.log(`${failures.length} failures written to upload-failures.json`)
}
console.log(`uploaded ${done}, skipped ${skipped}, failed ${failed}, ${(bytes / 1048576).toFixed(1)} MB`)
