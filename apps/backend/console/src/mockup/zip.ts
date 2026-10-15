// Downloads for Mockup Studio: a STORE-only ZIP writer (the PNGs are already
// compressed), saving a Blob, and the phone share sheet. No dependencies.

let table: Uint32Array | null = null

/** CRC-32 (IEEE, the one ZIP and PNG use). crc32("123456789") === 0xcbf43926. */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = ~0
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)
  return ~crc >>> 0
}

export type ZipEntry = { name: string; blob: Blob; crc: number }

const TOO_LARGE = "Too large for one ZIP. Download one model at a time."

/**
 * A ZIP of the entries, stored (method 0), names in UTF-8. The parts are the small headers plus the entry Blobs
 * themselves, so the pictures are never copied into the JavaScript heap.
 */
export function makeZip(entries: ZipEntry[], when = new Date()): Blob {
  if (entries.length > 0xffff) throw new Error(TOO_LARGE)
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const encoder = new TextEncoder()
  const names = entries.map((e) => encoder.encode(e.name))
  const parts: BlobPart[] = []
  const offsets: number[] = []
  let offset = 0
  entries.forEach((e, k) => {
    const name = names[k]
    const head = new Uint8Array(30 + name.length)
    const v = new DataView(head.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x0800, true)
    v.setUint16(8, 0, true)
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    v.setUint32(14, e.crc >>> 0, true)
    v.setUint32(18, e.blob.size, true)
    v.setUint32(22, e.blob.size, true)
    v.setUint16(26, name.length, true)
    v.setUint16(28, 0, true)
    head.set(name, 30)
    offsets.push(offset)
    parts.push(head, e.blob)
    offset += head.length + e.blob.size
    if (offset > 0xffffffff) throw new Error(TOO_LARGE)
  })
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0)
  const central = new Uint8Array(centralSize + 22)
  const v = new DataView(central.buffer)
  let p = 0
  entries.forEach((e, k) => {
    const name = names[k]
    v.setUint32(p, 0x02014b50, true)
    v.setUint16(p + 4, 20, true)
    v.setUint16(p + 6, 20, true)
    v.setUint16(p + 8, 0x0800, true)
    v.setUint16(p + 10, 0, true)
    v.setUint16(p + 12, time, true)
    v.setUint16(p + 14, date, true)
    v.setUint32(p + 16, e.crc >>> 0, true)
    v.setUint32(p + 20, e.blob.size, true)
    v.setUint32(p + 24, e.blob.size, true)
    v.setUint16(p + 28, name.length, true)
    v.setUint16(p + 30, 0, true) // extra
    v.setUint16(p + 32, 0, true) // comment
    v.setUint16(p + 34, 0, true) // disk
    v.setUint16(p + 36, 0, true) // internal attributes
    v.setUint32(p + 38, 0, true) // external attributes
    v.setUint32(p + 42, offsets[k], true)
    central.set(name, p + 46)
    p += 46 + name.length
  })
  if (offset + centralSize > 0xffffffff) throw new Error(TOO_LARGE)
  v.setUint32(p, 0x06054b50, true)
  v.setUint16(p + 4, 0, true)
  v.setUint16(p + 6, 0, true)
  v.setUint16(p + 8, entries.length, true)
  v.setUint16(p + 10, entries.length, true)
  v.setUint32(p + 12, centralSize, true)
  v.setUint32(p + 16, offset, true)
  v.setUint16(p + 20, 0, true)
  parts.push(central)
  return new Blob(parts, { type: "application/zip" })
}

/** Saves a Blob through the browser's download (the link's object URL is released after a minute). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Whether the share sheet can take files like this one (phones; "Save Image" on iPhone). */
export const canShareFiles = (sample: File) => typeof navigator.canShare === "function" && navigator.canShare({ files: [sample] })

/**
 * Opens the share sheet with a file made beforehand. Call it straight from the tap, with nothing awaited before it:
 * browsers only allow the sheet within the tap's user activation (a few seconds, less on iPhone). Closing the sheet
 * is not an error.
 */
export function shareReady(file: File): Promise<void> {
  return navigator.share({ files: [file] }).catch((error: any) => { if (error?.name !== "AbortError") throw error })
}
