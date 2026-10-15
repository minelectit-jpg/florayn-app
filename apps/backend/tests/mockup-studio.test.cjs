const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

function load(file, requireFn = () => ({})) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(out, { exports, require: requireFn, Math, Float32Array, Uint8Array, Uint8ClampedArray, URL, Set, Number, String, Array, Object, JSON, Error, isFinite, Infinity })
  return exports
}

const settingsLib = load("src/lib/mockup-settings.ts", () => ({ Modules: { STORE: "store" } }))
const { mockupSettings, validateMockupSettings, MOCKUP_DEFAULTS } = settingsLib
const caseTypes = [{ slug: "signature" }, { slug: "armor-black" }]
const devices = [{ slug: "iphone-18-pro-max" }, { slug: "iphone-17-pro" }]
const set = { device: "iphone-18-pro-max", base_url: "https://pub-x.r2.dev/mockups/iphone-18-pro-max/v1/", colours: ["Black", "Wine Red"], default_colour: "Black", enabled: true }
const good = { case_type: "signature", shots: [1, 2, 13], image_size: 1200, quality: 85, sets: [set] }

test("saved settings fall back to defaults when missing or malformed", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(mockupSettings(null))), JSON.parse(JSON.stringify(MOCKUP_DEFAULTS)))
  const odd = mockupSettings({ case_type: "", shots: [0, 2, 2, "x"], image_size: 999, quality: 3, sets: [set, { device: "x" }, null] })
  assert.equal(odd.case_type, "signature")
  assert.deepEqual([...odd.shots], [2])
  assert.equal(odd.image_size, 1200)
  assert.equal(odd.quality, 85)
  assert.equal(odd.sets.length, 1)
  assert.equal(mockupSettings({ sets: [{ ...set, default_colour: "Pink" }] }).sets[0].default_colour, "Black")
})

test("valid settings save with the folder address trimmed", () => {
  const saved = validateMockupSettings(good, caseTypes, devices)
  assert.equal(saved.sets[0].base_url, "https://pub-x.r2.dev/mockups/iphone-18-pro-max/v1")
  assert.deepEqual([...saved.shots], [1, 2, 13])
  const local = validateMockupSettings({ ...good, sets: [{ ...set, base_url: "http://127.0.0.1:5190/layers/x" }] }, caseTypes, devices)
  assert.equal(local.sets[0].base_url, "http://127.0.0.1:5190/layers/x")
})

test("unknown, duplicate, insecure and malformed settings are refused", () => {
  const bad = [
    { case_type: "missing" },
    { shots: [] },
    { shots: [1, 1] },
    { shots: [0] },
    { image_size: 1000 },
    { quality: 49 },
    { sets: [{ ...set, device: "iphone-99" }] },
    { sets: [set, { ...set }] },
    { sets: [{ ...set, base_url: "http://pub-x.r2.dev/m" }] },
    { sets: [{ ...set, base_url: "http://localhost.evil.test/m" }] },
    { sets: [{ ...set, base_url: "https://pub-x.r2.dev/m?x=1" }] },
    { sets: [{ ...set, base_url: "not a url" }] },
    { sets: [{ ...set, colours: [] }] },
    { sets: [{ ...set, colours: ["Black", "Black"] }] },
    { sets: [{ ...set, colours: ["../x"] }] },
    { sets: [{ ...set, default_colour: "Pink" }] },
    { sets: [{ ...set, enabled: "yes" }] },
  ]
  for (const patch of bad) assert.throws(() => validateMockupSettings({ ...good, ...patch }, caseTypes, devices), undefined, JSON.stringify(patch))
  assert.throws(() => validateMockupSettings(null, caseTypes, devices))
})

// --- compositor maths -----------------------------------------------------------------------------
const { composite, prepareDesign } = load("console/src/mockup/compositor.ts")
const enc = (v) => Math.round(Math.sqrt(v / (1 + v)) * 255)
const srgb = (x) => Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255)

// a 2x2 design: top row red, bottom row blue (Blender v = 0 is the bottom)
const designPx = [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]
const design = prepareDesign(designPx, 2, 2, 3, 1)
const meta = { template_mm: [2, 2], ink_saturation: 1 }

function layersFor(pixels) {
  const n = pixels.length
  const L = { w: n, h: 1, static: new Uint8Array(n * 3), light: new Uint8Array(n * 3), uv: new Uint8Array(n * 3), aux: new Uint8Array(n * 3), blur: new Uint8Array(n) }
  pixels.forEach((p, i) => {
    const u = Math.round(p.u * 65535), v = Math.round(p.v * 65535)
    for (let c = 0; c < 3; c++) { L.static[i * 3 + c] = enc(p.static); L.light[i * 3 + c] = enc(p.light) }
    L.uv[i * 3] = u >> 8; L.uv[i * 3 + 1] = u & 255; L.uv[i * 3 + 2] = v >> 8
    L.aux[i * 3] = v & 255; L.aux[i * 3 + 1] = Math.round(p.alpha * 255); L.aux[i * 3 + 2] = Math.round(p.mask * 255)
  })
  return L
}

test("print pixels take the design colour times the light, rows the Blender way up", () => {
  const out = composite(layersFor([
    { u: 0.25, v: 0.75, static: 0, light: 0.5, alpha: 1, mask: 1 }, // top row -> red
    { u: 0.25, v: 0.25, static: 0, light: 0.5, alpha: 1, mask: 1 }, // bottom row -> blue
  ]), meta, design)
  assert.ok(out[0] > 150 && out[1] === 0 && out[2] === 0, `red pixel ${[...out.slice(0, 4)]}`)
  assert.ok(out[4] === 0 && out[5] === 0 && out[6] > 150, `blue pixel ${[...out.slice(4, 8)]}`)
  assert.equal(out[3], 255)
})

test("non-print pixels keep the background, transparent ones stay empty", () => {
  const out = composite(layersFor([
    { u: 0, v: 0, static: 0.18, light: 0, alpha: 1, mask: 0 },
    { u: 0, v: 0, static: 0, light: 0, alpha: 0, mask: 0 },
  ]), meta, design)
  // 0.18 grey through PBR Neutral: offset 0.04 below 0.76, then sRGB
  assert.ok(Math.abs(out[0] - srgb(0.18 - 0.04)) <= 2, `grey ${out[0]} vs ${srgb(0.14)}`)
  assert.equal(out[0], out[1]); assert.equal(out[1], out[2])
  assert.deepEqual([...out.slice(4, 8)], [0, 0, 0, 0])
})

test("ink saturation is applied once, when the design is prepared", () => {
  const grey = prepareDesign([128, 128, 128], 1, 1, 3, 1.5)
  assert.deepEqual([...grey.levels[0].data], [128, 128, 128])
  const muted = prepareDesign([200, 120, 120], 1, 1, 3, 1.2)
  assert.ok(muted.levels[0].data[1] < 120, "saturation pulls the weaker channels down")
})
