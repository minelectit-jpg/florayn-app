const v8 = require("node:v8")
const zlib = require("node:zlib")
const { promisify } = require("node:util")

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)
const ROUTE_FORMAT = "v2:"

// FETCH keys are shared with earlier deployments. Keep their wire format
// unchanged so a rollout or rollback can continue using the existing warm data.
function serializeLegacy(value) {
  return JSON.stringify(value, (_key, entry) =>
    entry instanceof Map ? { __map__: Array.from(entry.entries()) } : entry
  )
}

function restoreLegacy(value) {
  if (!value || typeof value !== "object") return value
  // Check Buffer before traversing its children: a JSON reviver visits every
  // individual byte first, costing nearly a second for a 763 KB RSC payload.
  if (value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data)
  }
  if (Array.isArray(value.__map__)) {
    return new Map(value.__map__.map(([key, entry]) => [restoreLegacy(key), restoreLegacy(entry)]))
  }
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") {
      value[key] = restoreLegacy(value[key])
    }
  }
  return value
}

function deserializeLegacy(raw) {
  return restoreLegacy(JSON.parse(raw))
}

// Only versioned, build-specific route keys use this codec. V8 preserves Buffer
// and Map without expanding binary data into arrays of JSON numbers. Compression
// runs on the worker pool; the Redis client still reads/writes ordinary strings.
async function serializeRoute(value) {
  const compressed = await gzip(v8.serialize(value), { level: zlib.constants.Z_BEST_SPEED })
  return ROUTE_FORMAT + compressed.toString("base64")
}

async function deserializeRoute(raw) {
  if (!raw.startsWith(ROUTE_FORMAT)) throw new Error("Unsupported route cache format")
  const compressed = Buffer.from(raw.slice(ROUTE_FORMAT.length), "base64")
  const payload = await gunzip(compressed, { maxOutputLength: 64 * 1024 * 1024 })
  return v8.deserialize(payload)
}

module.exports = { serializeLegacy, deserializeLegacy, serializeRoute, deserializeRoute }
