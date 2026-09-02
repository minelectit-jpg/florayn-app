/** How many objects are in the bucket, and how many bytes. */
import fs from "node:fs"
import path from "node:path"
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3"

const ENV = path.join(import.meta.dirname, "..", "apps", "backend", ".env")
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

let token, n = 0, bytes = 0
const families = {}
do {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: R2_BUCKET, ContinuationToken: token, MaxKeys: 1000,
  }))
  for (const o of res.Contents ?? []) {
    n++; bytes += o.Size ?? 0
    const fam = o.Key.split("/")[2] ?? "(root)"
    families[fam] = (families[fam] || 0) + 1
  }
  token = res.IsTruncated ? res.NextContinuationToken : undefined
} while (token)

console.log(`objects in ${R2_BUCKET}: ${n}`)
console.log(`bytes                  : ${(bytes / 1048576).toFixed(1)} MB`)
console.log(`by family              : ${JSON.stringify(families)}`)
