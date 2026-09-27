// The backend and the storefront each test their own copy of the shared tracking
// vectors (TRACKING.md Appendix C): host roles, destinations, derived keys, paths
// and event ids. If the copies drift, both suites can pass while the two apps
// disagree about who gets tracked, so this test pins them to one source.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const root = path.join(__dirname, "../../..")
const backendCopy = path.join(root, "apps/backend/tests/fixtures/tracking-vectors.json")
const storefrontCopy = path.join(root, "apps/storefront/tests/fixtures/tracking-vectors.json")

// A Windows checkout (core.autocrlf) rewrites every file the same way, so the
// comparison with the document ignores line endings; the two copies are compared raw.
const text = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")

function appendixC() {
  const doc = text(path.join(root, "TRACKING.md"))
  const heading = doc.indexOf("\n## Appendix C")
  assert.ok(heading > 0, "TRACKING.md has an Appendix C heading")
  const open = doc.indexOf("```json\n", heading)
  assert.ok(open > 0, "Appendix C has a json block")
  const start = open + "```json\n".length
  const end = doc.indexOf("\n```", start)
  assert.ok(end > start, "the json block is closed")
  return doc.slice(start, end + 1)
}

test("the backend and storefront vector fixtures are byte-identical", () => {
  const backend = fs.readFileSync(backendCopy)
  const storefront = fs.readFileSync(storefrontCopy)
  assert.ok(backend.length > 0, "the backend copy is not empty")
  assert.ok(backend.equals(storefront), "apps/backend and apps/storefront tests/fixtures/tracking-vectors.json differ")
})

test("both fixtures equal the Appendix C block of TRACKING.md", () => {
  const block = appendixC()
  assert.equal(text(backendCopy), block, "the backend copy differs from Appendix C")
  assert.equal(text(storefrontCopy), block, "the storefront copy differs from Appendix C")
})

test("the shared block is valid JSON with every vector group both apps read", () => {
  const vectors = JSON.parse(appendixC())
  assert.equal(vectors.version, 1)
  for (const key of ["private_paths", "safe_path", "landing_params", "event_ids", "events", "host_role", "destination", "keys", "source", "hashes"]) {
    assert.ok(Object.hasOwn(vectors, key), `Appendix C has ${key}`)
  }
})
