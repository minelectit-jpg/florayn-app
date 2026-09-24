const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

// Medusa records every module's migrations in one mikro_orm_migrations table
// keyed by class name, so a name used by two modules runs only the first one.
test("no two module migrations share a name", () => {
  const modules = path.join(__dirname, "../src/modules")
  const seen = new Map()
  for (const mod of fs.readdirSync(modules)) {
    const dir = path.join(modules, mod, "migrations")
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(dir, file), "utf8")
      const name = source.match(/export class (\w+) extends Migration/)?.[1]
      assert.ok(name, `${mod}/${file} exports a migration class`)
      assert.equal(name, file.replace(/\.ts$/, ""), `${mod}/${file} is named after its file`)
      assert.ok(!seen.has(name), `${name} is used by both ${seen.get(name)} and ${mod}`)
      seen.set(name, mod)
    }
  }
})
