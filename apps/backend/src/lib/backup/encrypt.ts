import fs from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * age encryption (https://age-encryption.org) to the owner's public key. Only
 * the owner's private key (on a USB stick and on paper, never on the server)
 * can open the files: with the `age` command-line tool or
 * scripts/backup-decrypt.mjs. The library is ESM-only, so it is loaded with a
 * dynamic import; tests pass it in.
 */
/** The part of age-encryption used here (the package is ESM-only, so no static type import from CommonJS). */
export type AgeLib = {
  Encrypter: new () => { addRecipient(recipient: string): void; encrypt(file: any): Promise<any> }
}

async function loadAge(lib?: AgeLib): Promise<AgeLib> {
  return lib ?? (await import("age-encryption")) as unknown as AgeLib
}

/** Streams `src` into an age file at `dst` (mode 600). Returns the encrypted size in bytes. */
export async function encryptFile(src: string, dst: string, recipient: string, lib?: AgeLib): Promise<number> {
  const age = await loadAge(lib)
  const encrypter = new age.Encrypter()
  encrypter.addRecipient(recipient)
  const input = Readable.toWeb(fs.createReadStream(src)) as unknown as ReadableStream<Uint8Array>
  const output = await encrypter.encrypt(input)
  await pipeline(Readable.fromWeb(output as any), fs.createWriteStream(dst, { mode: 0o600 }))
  return fs.statSync(dst).size
}

/** Encrypts a small text (the settings snapshot) into an age file. Returns the encrypted size. */
export async function encryptText(text: string, dst: string, recipient: string, lib?: AgeLib): Promise<number> {
  const age = await loadAge(lib)
  const encrypter = new age.Encrypter()
  encrypter.addRecipient(recipient)
  const bytes = await encrypter.encrypt(text)
  fs.writeFileSync(dst, bytes, { mode: 0o600 })
  return bytes.length
}
