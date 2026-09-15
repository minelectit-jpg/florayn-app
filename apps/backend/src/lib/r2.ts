import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

/**
 * A thin R2 (S3-compatible) helper for the admin File Manager. The Medusa file
 * module can upload and delete, but not LIST a bucket, so the file manager talks
 * to R2 directly with the same credentials the file provider uses. All media
 * lives in R2; this is the read/write window onto it.
 */

let cached: S3Client | null = null

export function r2Client(): S3Client {
  if (cached) return cached
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 is not configured (need R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)."
    )
  }
  cached = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
  return cached
}

export function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET
  if (!bucket) throw new Error("R2_BUCKET is not set.")
  return bucket
}

export function r2PublicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "")
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `${base}/${encoded}`
}

/** Strip leading slashes, drop . / .. and blank segments. Keeps case and spaces. */
export function cleanKey(input: string): string {
  return String(input ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("/")
}

/** A folder prefix always ends with a single trailing slash (or is empty = root). */
export function asPrefix(input?: string): string {
  const k = cleanKey(input ?? "")
  return k ? `${k}/` : ""
}

export type R2Listing = {
  prefix: string
  folders: { name: string; prefix: string }[]
  files: { name: string; key: string; url: string; size: number; lastModified?: string }[]
}

export async function listPrefix(prefixInput?: string): Promise<R2Listing> {
  const prefix = asPrefix(prefixInput)
  const folders: R2Listing["folders"] = []
  const files: R2Listing["files"] = []
  let ContinuationToken: string | undefined
  do {
    const res = await r2Client().send(
      new ListObjectsV2Command({
        Bucket: r2Bucket(),
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken,
        MaxKeys: 1000,
      })
    )
    for (const cp of res.CommonPrefixes ?? []) {
      const p = cp.Prefix
      if (!p) continue
      const name = p.slice(prefix.length).replace(/\/$/, "")
      if (name) folders.push({ name, prefix: p })
    }
    for (const obj of res.Contents ?? []) {
      const key = obj.Key
      if (!key || key === prefix || key.endsWith("/")) continue // skip folder markers
      files.push({
        name: key.slice(prefix.length),
        key,
        url: r2PublicUrl(key),
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString(),
      })
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)

  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { prefix, folders, files }
}

/** Every object key under a prefix (recursive, no delimiter). */
export async function listAllUnder(prefixInput?: string): Promise<string[]> {
  const prefix = asPrefix(prefixInput)
  const keys: string[] = []
  let ContinuationToken: string | undefined
  do {
    const res = await r2Client().send(
      new ListObjectsV2Command({
        Bucket: r2Bucket(),
        Prefix: prefix,
        ContinuationToken,
        MaxKeys: 1000,
      })
    )
    for (const obj of res.Contents ?? []) {
      const key = obj.Key
      if (!key || key.endsWith("/")) continue
      keys.push(key)
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
  return keys
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ key: string; url: string }> {
  const Key = cleanKey(key)
  if (!Key) throw new Error("A key is required.")
  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    })
  )
  return { key: Key, url: r2PublicUrl(Key) }
}

/** Create an (empty) folder by writing its zero-byte marker object. */
export async function createFolder(prefixInput: string): Promise<{ prefix: string }> {
  const prefix = asPrefix(prefixInput)
  if (!prefix) throw new Error("A folder name is required.")
  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: prefix,
      Body: "",
      ContentType: "application/x-directory",
    })
  )
  return { prefix }
}

export async function deleteObject(keyInput: string): Promise<{ deleted: number }> {
  const Key = cleanKey(keyInput)
  if (!Key) throw new Error("A key is required.")
  await r2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key }))
  return { deleted: 1 }
}

/** Delete every object under a folder prefix (recursive). */
export async function deletePrefix(prefixInput: string): Promise<{ deleted: number }> {
  const prefix = asPrefix(prefixInput)
  if (!prefix) throw new Error("A folder is required.")
  let deleted = 0
  let ContinuationToken: string | undefined
  do {
    const res = await r2Client().send(
      new ListObjectsV2Command({
        Bucket: r2Bucket(),
        Prefix: prefix,
        ContinuationToken,
        MaxKeys: 1000,
      })
    )
    const objects = (res.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k)
      .map((Key) => ({ Key }))
    if (objects.length) {
      await r2Client().send(
        new DeleteObjectsCommand({
          Bucket: r2Bucket(),
          Delete: { Objects: objects, Quiet: true },
        })
      )
      deleted += objects.length
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
  return { deleted }
}
