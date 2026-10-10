#!/usr/bin/env node
// Opens a Florayn backup (BACKUP.md, "Restore"). Run on your own computer,
// from the repository root after `npm install`:
//
//   node apps/backend/scripts/backup-decrypt.mjs <private-key-file> <backup.age> <output-file>
//
// The private key file is the one Admin > Backups downloaded
// (florayn-backup-PRIVATE-key.txt). The official `age` tool opens the same files:
//   age --decrypt -i florayn-backup-PRIVATE-key.txt -o out.dump florayn-db-....dump.age
import fs from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { Decrypter } from "age-encryption"

const [keyFile, input, output] = process.argv.slice(2)
if (!keyFile || !input || !output) {
  console.error("Usage: node apps/backend/scripts/backup-decrypt.mjs <private-key-file> <backup.age> <output-file>")
  process.exit(2)
}
if (fs.existsSync(output)) {
  console.error(`${output} already exists; choose another output name.`)
  process.exit(2)
}

const identities = fs.readFileSync(keyFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
if (!identities.length) {
  console.error("No AGE-SECRET-KEY line found in the key file.")
  process.exit(2)
}

const decrypter = new Decrypter()
for (const identity of identities) decrypter.addIdentity(identity)
try {
  const plain = await decrypter.decrypt(Readable.toWeb(fs.createReadStream(input)))
  await pipeline(Readable.fromWeb(plain), fs.createWriteStream(output, { mode: 0o600 }))
  console.log(`Opened ${input} -> ${output} (${fs.statSync(output).size} bytes)`)
} catch (error) {
  fs.rmSync(output, { force: true })
  console.error(`Could not open the backup: ${error?.message ?? error}. Is this the right private key?`)
  process.exit(1)
}
