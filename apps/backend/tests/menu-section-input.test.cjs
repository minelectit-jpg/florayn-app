const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

// Load the real source and its relative imports.
function load(relative) {
  const cache = new Map()
  function loadFile(file) {
    if (cache.has(file)) return cache.get(file)
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    vm.runInNewContext(code, {
      exports: module.exports, module, URL,
      require(name) {
        if (name.startsWith(".")) return loadFile(`${path.resolve(path.dirname(file), name)}.ts`)
        throw new Error(`Unexpected dependency ${name} in ${file}`)
      },
    }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  return loadFile(path.join(__dirname, "../src", relative))
}
const plain = (value) => JSON.parse(JSON.stringify(value))

const input = load("lib/menu-section-input.ts")
const { sanitizeMenuSectionInput: sanitize, MENU_SECTION_MESSAGES: M } = input
const CASE_TYPES = ["signature", "signature-earbuds", "alcantara"]
const header = (kind = "links") => ({ menu: "primary", kind, caseTypes: CASE_TYPES })
const rejects = (body, context, message) => assert.throws(() => sanitize(body, context), (error) => error.message === message)

test("each of the four kinds is accepted with its settings filled in", () => {
  assert.deepEqual(plain(sanitize({ kind: "links" }, header("devices"))), { kind: "links", config: null })
  assert.deepEqual(plain(sanitize({ kind: "devices", config: { families: ["samsung", "iphone", "samsung"], case_type: "signature" } }, header())), {
    kind: "devices", config: { families: ["samsung", "iphone"], case_type: "signature" },
  }, "brand order is kept and repeats dropped")
  assert.deepEqual(plain(sanitize({ kind: "devices", config: { families: ["airpods"], case_type: "" } }, header())).config, { families: ["airpods"], case_type: null })
  assert.deepEqual(plain(sanitize({ kind: "case_types", config: { exclude: ["armor-black", "armor-black", "Bad Slug"], links: { alcantara: " /collection/alcantara/ ", essentials: "" } } }, header())), {
    kind: "case_types", config: { form: "phone", exclude: ["armor-black"], links: { alcantara: "/collection/alcantara/" } },
  })
  assert.equal(sanitize({ kind: "case_types", config: { form: "airpods" } }, header()).config.form, "airpods")
  assert.deepEqual(plain(sanitize({ kind: "collections", config: {} }, header())).config, { title: "Collections", view_all_href: "/collections/", limit: 8 })
  assert.deepEqual(plain(sanitize({ kind: "collections", config: { title: " Shop by collection ", view_all_href: "https://new.florayn.com/collections/", limit: 12 } }, header())).config, {
    title: "Shop by collection", view_all_href: "https://new.florayn.com/collections/", limit: 12,
  })
})

test("the three placements are accepted and anything else is refused", () => {
  for (const placement of ["all", "drawer", "bar"]) assert.equal(sanitize({ placement }, header()).placement, placement)
  rejects({ placement: "footer" }, header(), M.placement)
})

test("switching kind without settings starts that kind's defaults; other fields are only patched when sent", () => {
  assert.deepEqual(plain(sanitize({ kind: "collections" }, header())), { kind: "collections", config: { title: "Collections", view_all_href: "/collections/", limit: 8 } })
  assert.deepEqual(plain(sanitize({ kind: "devices" }, header())).config, { families: ["iphone", "samsung"], case_type: null })
  assert.deepEqual(plain(sanitize({ kind: "devices" }, header("devices"))), { kind: "devices" }, "the same kind keeps its saved settings")
  assert.deepEqual(plain(sanitize({ config: { families: ["watch"] } }, header("devices"))), { config: { families: ["watch"], case_type: null } }, "settings follow the saved kind")
  assert.deepEqual(plain(sanitize({}, header())), {})
  assert.deepEqual(plain(sanitize({ badge: " New ", image_url: " https://pub.r2.dev/site/menu/phone.webp " }, header())), { badge: "New", image_url: "https://pub.r2.dev/site/menu/phone.webp" })
  assert.deepEqual(plain(sanitize({ badge: "", image_url: "" }, header())), { badge: null, image_url: null }, "blank clears")
  assert.deepEqual(plain(sanitize({ badge: null, image_url: null }, header())), { badge: null, image_url: null })
  assert.equal(sanitize({ badge: "123456789012" }, header()).badge, "123456789012", "12 characters is the limit")
})

test("bad input is refused with the admin's wording", () => {
  rejects({ kind: "mega" }, header(), "Type must be Links, Device models, Case styles or Collections row.")
  rejects({ badge: "1234567890123" }, header(), "Badge must be 12 characters or fewer.")
  rejects({ image_url: "http://pub.r2.dev/a.webp" }, header(), "Use an https image link (pick one from the media library).")
  rejects({ image_url: "/site/a.webp" }, header(), M.image)
  rejects({ image_url: "javascript:alert(1)" }, header(), M.image)
  rejects({ kind: "devices", config: { families: [] } }, header(), "Pick at least one brand.")
  rejects({ kind: "devices", config: {} }, header(), M.families)
  rejects({ kind: "devices", config: { families: ["iphone", "nokia"] } }, header(), M.family)
  rejects({ kind: "devices", config: { families: ["iphone"], case_type: "leather" } }, header(), "That case type does not exist.")
  rejects({ kind: "case_types", config: { links: { alcantara: "javascript:alert(1)" } } }, header(), "Use a site path like /collection/leopard/ or a full https link.")
  rejects({ kind: "case_types", config: { links: { alcantara: "//evil.example/" } } }, header(), M.href)
  rejects({ kind: "case_types", config: { links: { alcantara: "http://florayn.com/" } } }, header(), M.href)
  rejects({ kind: "case_types", config: { form: "laptop" } }, header(), M.form)
  rejects({ kind: "collections", config: { limit: 0 } }, header(), "Show between 1 and 12 collections.")
  rejects({ kind: "collections", config: { limit: 13 } }, header(), M.limit)
  rejects({ kind: "collections", config: { limit: 2.5 } }, header(), M.limit)
  rejects({ kind: "collections", config: { view_all_href: "javascript:alert(1)" } }, header(), M.href)
  rejects({ kind: "collections", config: { title: "x".repeat(41) } }, header(), M.title)
})

test("a devices case type must be one of the active case types passed in", () => {
  assert.throws(() => sanitize({ config: { families: ["iphone"], case_type: "alcantara" } }, { menu: "primary", kind: "devices", caseTypes: [] }), { message: M.caseType })
  assert.equal(sanitize({ config: { families: ["iphone"], case_type: "alcantara" } }, { menu: "primary-men", kind: "devices", caseTypes: CASE_TYPES }).config.case_type, "alcantara")
  assert.equal(input.needsCaseTypes({ kind: "devices", config: {} }), true)
  assert.equal(input.needsCaseTypes({ config: {} }, "devices"), true)
  assert.equal(input.needsCaseTypes({ kind: "devices" }), false, "defaults need no check")
  assert.equal(input.needsCaseTypes({ config: {} }, "collections"), false)
})

test("a footer section is forced to links shown everywhere", () => {
  const footer = { menu: "footer", kind: "links", caseTypes: [] }
  assert.deepEqual(plain(sanitize({ kind: "devices", placement: "drawer", config: { families: ["iphone"] } }, footer)), { kind: "links", placement: "all", config: null })
  assert.deepEqual(plain(sanitize({ kind: "not-a-kind" }, footer)), { kind: "links", placement: "all", config: null })
  assert.deepEqual(plain(sanitize({ badge: "Hi" }, footer)), { badge: "Hi" })
})

test("menu links: site paths and full https links only", () => {
  for (const ok of ["/collection/leopard/", "/collection/card-wallets/?device=Card%20Wallet", "https://new.florayn.com/x/"]) assert.equal(input.safeMenuHref(ok), true, ok)
  for (const bad of ["", "javascript:alert(1)", "//evil.example", "http://florayn.com/", "/a b/", "/a\\b", "mailto:x@y.z", "https://user:pw@florayn.com/", null, 5]) {
    assert.equal(input.safeMenuHref(bad), false, String(bad))
  }
})
