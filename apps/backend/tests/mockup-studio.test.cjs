const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// extra: more globals for one module (e.g. a fetch stub)
function load(file, requireFn = () => ({}), extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(out, {
    exports, require: requireFn, Math, Float32Array, Uint8Array, Uint8ClampedArray, Uint32Array, URL, Set, Map, Number, String, Array, Object, JSON, Error, isFinite, Infinity,
    Blob, DataView, TextEncoder, Date, Promise, ...extra,
  })
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
  assert.equal(odd.quality, 92)
  assert.equal(odd.supersample, true)
  assert.equal(odd.sets.length, 1)
  assert.equal(mockupSettings({ quality: 85, supersample: false }).quality, 85, "a saved quality is kept")
  assert.equal(mockupSettings({ supersample: false }).supersample, false)
  assert.equal(mockupSettings({ supersample: "no" }).supersample, true)
  assert.equal(mockupSettings({ sets: [{ ...set, default_colour: "Pink" }] }).sets[0].default_colour, "Black")
})

test("shop images default to quality 92, made from the 2400 px renders", () => {
  assert.equal(MOCKUP_DEFAULTS.quality, 92)
  assert.equal(MOCKUP_DEFAULTS.supersample, true)
  assert.equal(validateMockupSettings(good, caseTypes, devices).supersample, true, "left out means on")
  assert.equal(validateMockupSettings({ ...good, supersample: false }, caseTypes, devices).supersample, false)
  assert.equal(validateMockupSettings({ ...good, supersample: true }, caseTypes, devices).supersample, true)
  assert.throws(() => validateMockupSettings({ ...good, supersample: "yes" }, caseTypes, devices), /2400 px renders/)
  assert.throws(() => validateMockupSettings({ ...good, supersample: 1 }, caseTypes, devices), /2400 px renders/)
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
const compositor = load("console/src/mockup/compositor.ts")
const { composite, prepareDesign, denoiseBlur, SHARPNESS } = compositor
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

test("the sharpness defaults are the ones matched to the Blender finals", () => {
  assert.deepEqual({ ...SHARPNESS }, { blurScale: 1.5, lodBias: -0.5 })
  const L = layersFor([
    { u: 0.25, v: 0.75, static: 0, light: 0.5, alpha: 1, mask: 1 },
    { u: 0.25, v: 0.25, static: 0, light: 0.5, alpha: 1, mask: 1 },
  ])
  assert.deepEqual([...composite(L, meta, design)], [...composite(L, meta, design, { blurScale: 1.5, lodBias: -0.5 })])
})

test("the mip level is clamped: a negative bias stays on the design, a large one stops at the last level", () => {
  // the two print pixels are one design pixel apart (footprint 1, lod 0 before the bias)
  const L = layersFor([
    { u: 0.25, v: 0.75, static: 0, light: 0.5, alpha: 1, mask: 1 },
    { u: 0.25, v: 0.25, static: 0, light: 0.5, alpha: 1, mask: 1 },
  ])
  const sharp = composite(L, meta, design, { blurScale: 1.5, lodBias: -0.5 })
  assert.deepEqual([...sharp], [...composite(L, meta, design, { blurScale: 1.5, lodBias: 0 })], "lod below 0 is level 0")
  assert.ok(sharp[0] > 150 && sharp[6] > 150, `red and blue ${[...sharp]}`)
  const soft = composite(L, meta, design, { blurScale: 1.5, lodBias: 100 })
  // the last level is the 1 x 1 average of red and blue: both pixels the same purple
  assert.deepEqual([...soft.slice(0, 4)], [...soft.slice(4, 8)])
  assert.ok(soft[0] > 100 && soft[2] > 100 && soft[1] === 0, `purple ${[...soft.slice(0, 4)]}`)
  // the depth-of-field spread is scaled by blurScale: a strong blur reaches the last level, blurScale 0 ignores it
  L.blur.fill(255)
  assert.deepEqual([...composite(L, meta, design, { blurScale: 1, lodBias: 0 })], [...soft])
  assert.deepEqual([...composite(L, meta, design, { blurScale: 0, lodBias: 0 })], [...sharp])
})

// blur values and print coverage for a w x h shot, for denoiseBlur
function blurGrid(w, h, value, cover = 255) {
  return { blur: new Uint8Array(w * h).fill(value), aux: new Uint8Array(w * h * 3).map((_, k) => (k % 3 === 2 ? cover : 0)) }
}

test("denoiseBlur takes the 5x5 median over print pixels and leaves the rest alone", () => {
  const { blur, aux } = blurGrid(7, 7, 10)
  blur[3 * 7 + 3] = 200 // one speck in the middle of the print
  const out = denoiseBlur(blur, aux, 7, 7)
  assert.equal(out[3 * 7 + 3], 10)
  assert.equal(blur[3 * 7 + 3], 200, "the input is not changed")
  // outside the print (coverage 0): kept as it is, and not a sample for its neighbours
  for (const i of [0, 1, 2]) { aux[i * 3 + 2] = 0; blur[i] = 250 }
  const out2 = denoiseBlur(blur, aux, 7, 7)
  assert.equal(out2[0], 250)
  assert.equal(out2[7], 10, "a print pixel next to them ignores their values")
  // partly covered (1..127): gets the median of its print neighbours but is not a sample itself
  const g = blurGrid(5, 1, 40)
  g.aux[2 * 3 + 2] = 64; g.blur[2] = 0
  assert.deepEqual([...denoiseBlur(g.blur, g.aux, 5, 1)], [40, 40, 40, 40, 40])
})

test("denoiseBlur uses the lower median and copies Node Buffers instead of sharing them", () => {
  const two = blurGrid(2, 1, 0)
  two.blur[0] = 10; two.blur[1] = 20
  assert.deepEqual([...denoiseBlur(two.blur, two.aux, 2, 1)], [10, 10])
  // Buffer.slice shares memory: the median must still read the original values
  const buf = Buffer.from([10, 200, 10, 200, 10])
  assert.deepEqual([...denoiseBlur(buf, blurGrid(5, 1, 0).aux, 5, 1)], [10, 10, 10, 10, 10])
  assert.deepEqual([...buf], [10, 200, 10, 200, 10])
})

// The definition (Mockup Studio v2 spec 1.2): sort each 5x5 window. denoiseBlur must give the same bytes, faster.
function denoiseReference(blur, aux, w, h) {
  const out = new Uint8Array(blur), win = new Uint8Array(25)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (aux[i * 3 + 2] === 0) continue
      let n = 0
      for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
          const k = yy * w + xx
          if (aux[k * 3 + 2] < 128) continue
          const v = blur[k]
          let j = n++
          while (j > 0 && win[j - 1] > v) { win[j] = win[j - 1]; j-- }
          win[j] = v
        }
      }
      if (n) out[i] = win[(n - 1) >> 1]
    }
  }
  return out
}

test("denoiseBlur gives the same bytes as sorting every 5x5 window", () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
  for (let r = 0; r < 400; r++) {
    const w = 1 + Math.floor(rnd() * 23), h = 1 + Math.floor(rnd() * 23)
    // half noise, half near-zero (like in-focus print), and every kind of coverage
    const blur = new Uint8Array(w * h).map(() => (rnd() < 0.5 ? Math.floor(rnd() * 256) : Math.floor(rnd() * 8)))
    const aux = new Uint8Array(w * h * 3).map((_, k) => (k % 3 === 2 ? [0, 0, 64, 127, 128, 255, 255][Math.floor(rnd() * 7)] : 0))
    assert.deepEqual([...denoiseBlur(blur, aux, w, h)], [...denoiseReference(blur, aux, w, h)], `case ${r}: ${w} x ${h}`)
  }
})

// --- layers helpers ---------------------------------------------------------------------------------
const layersLib = load("console/src/mockup/layers.ts", (name) => (name === "./compositor" ? compositor : {}))

test("shot names give short labels, titles and file-name slugs", () => {
  const names = ["01 Front - design", "02 Protection - impact", "03 Layers - dual layer", "04 MagSafe charging", "05 Camera close-up",
    "06 Bottom close-up - ports & bezel", "07 Lying - side view", "08 Side - right (buttons)", "09 Side - left",
    "10 Front - screen with phone", "11 Hero - print & ports", "12 Side buttons close-up", "13 Inside - empty case", "14 Studio - top"]
  assert.deepEqual(names.map(layersLib.shotLabel), ["Front", "Protection", "Layers", "MagSafe", "Camera", "Bottom", "Lying",
    "Right side", "Left side", "Screen", "Hero", "Buttons", "Inside", "Studio"])
  assert.equal(layersLib.shotTitle("05 Camera close-up"), "Camera close-up")
  assert.equal(layersLib.angleSlug("05 Camera close-up"), "camera-close-up")
  assert.equal(layersLib.angleSlug("06 Bottom close-up - ports & bezel"), "bottom-close-up-ports-bezel")
})

test("design widths and packed sizes follow the quality levels", () => {
  assert.equal(layersLib.designWidthFor(2400, 4096), 4096)
  assert.equal(layersLib.designWidthFor(2400, 3072), 3072)
  assert.equal(layersLib.designWidthFor(1200, 4096), 2048)
  assert.equal(layersLib.designWidthFor(600, 4096), 1024)
  assert.equal(layersLib.pickSize([2400, 1200, 600], 1200), 1200)
  assert.equal(layersLib.pickSize([2400, 1200, 600], 1000), 600)
  assert.equal(layersLib.pickSize([1200, 600], 2400), 1200)
  assert.equal(layersLib.pickSize([1200], 600), 1200)
  assert.ok(Math.abs(layersLib.A_DEFAULT - 1.6004) < 1e-4)
})

test("the uv pick reads the artwork coordinate and its typical slope, skipping seams", () => {
  const w = 16, h = 16, n = w * h
  const uv = new Uint8Array(n * 3), aux = new Uint8Array(n * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const u = x / 32 + (x >= 12 ? 0.5 : 0), v = 1 - y / 32 // x = 12 is a seam: its jump is not a slope
      const U = Math.round(u * 65535), V = Math.round(v * 65535)
      uv[i * 3] = U >> 8; uv[i * 3 + 1] = U & 255; uv[i * 3 + 2] = V >> 8
      aux[i * 3] = V & 255; aux[i * 3 + 1] = 255; aux[i * 3 + 2] = y < 14 ? 255 : 0
    }
  }
  const pick = layersLib.uvPickFrom(uv, aux, w, h)
  assert.equal(pick.print, 14 * 16)
  assert.ok(Math.abs(pick.U[3] - 3 / 32) < 1e-4 && Math.abs(pick.V[2 * w] - (1 - 2 / 32)) < 1e-4)
  const [dudx, dudy, dvdx, dvdy] = pick.J
  assert.ok(Math.abs(dudx - 1 / 32) < 1e-4, `dU/dx ${dudx}`)
  assert.ok(Math.abs(dudy) < 1e-4 && Math.abs(dvdx) < 1e-4, `dU/dy ${dudy}, dV/dx ${dvdx}`)
  assert.ok(Math.abs(dvdy + 1 / 32) < 1e-4, `dV/dy ${dvdy}`)
})

// --- ZIP ----------------------------------------------------------------------------------------------
const { crc32, makeZip } = load("console/src/mockup/zip.ts")

test("crc32 is the IEEE CRC-32 of ZIP and PNG", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
  assert.equal(crc32(new Uint8Array(0)), 0)
  assert.equal(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")), 0x414fa339)
})

test("makeZip writes stored entries with valid local headers, central directory and end record", async () => {
  const files = [
    { name: "iphone-18-pro-max_black/01-front-design_2400.png", bytes: new Uint8Array(3000).map((_, i) => (i * 7) & 255) },
    { name: "café/02-protection-impact_1200.png", bytes: new TextEncoder().encode("not really a PNG") },
    { name: "empty.png", bytes: new Uint8Array(0) },
  ]
  const entries = files.map((f) => ({ name: f.name, blob: new Blob([f.bytes], { type: "image/png" }), crc: crc32(f.bytes) }))
  const zip = makeZip(entries, new Date(2026, 9, 16, 13, 45, 31))
  assert.equal(zip.type, "application/zip")
  const buf = Buffer.from(await zip.arrayBuffer())
  const time = (13 << 11) | (45 << 5) | 15, date = (46 << 9) | (10 << 5) | 16

  // end record
  const end = buf.length - 22
  assert.equal(buf.readUInt32LE(end), 0x06054b50)
  assert.equal(buf.readUInt16LE(end + 4) + buf.readUInt16LE(end + 6), 0)
  assert.equal(buf.readUInt16LE(end + 8), files.length)
  assert.equal(buf.readUInt16LE(end + 10), files.length)
  const cdSize = buf.readUInt32LE(end + 12), cdOffset = buf.readUInt32LE(end + 16)
  assert.equal(cdOffset + cdSize, end)
  assert.equal(buf.readUInt16LE(end + 20), 0)

  let p = cdOffset
  files.forEach((f, k) => {
    const name = Buffer.from(f.name, "utf8")
    // central entry
    assert.equal(buf.readUInt32LE(p), 0x02014b50)
    assert.equal(buf.readUInt16LE(p + 4), 20)
    assert.equal(buf.readUInt16LE(p + 6), 20)
    assert.equal(buf.readUInt16LE(p + 8), 0x0800)
    assert.equal(buf.readUInt16LE(p + 10), 0)
    assert.equal(buf.readUInt16LE(p + 12), time)
    assert.equal(buf.readUInt16LE(p + 14), date)
    assert.equal(buf.readUInt32LE(p + 16), entries[k].crc)
    assert.equal(buf.readUInt32LE(p + 20), f.bytes.length)
    assert.equal(buf.readUInt32LE(p + 24), f.bytes.length)
    assert.equal(buf.readUInt16LE(p + 28), name.length)
    assert.equal(buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32) + buf.readUInt16LE(p + 34) + buf.readUInt16LE(p + 36), 0)
    assert.equal(buf.readUInt32LE(p + 38), 0)
    assert.ok(buf.subarray(p + 46, p + 46 + name.length).equals(name))
    const local = buf.readUInt32LE(p + 42)
    p += 46 + name.length
    // local header, then the stored bytes
    assert.equal(buf.readUInt32LE(local), 0x04034b50)
    assert.equal(buf.readUInt16LE(local + 4), 20)
    assert.equal(buf.readUInt16LE(local + 6), 0x0800)
    assert.equal(buf.readUInt16LE(local + 8), 0)
    assert.equal(buf.readUInt16LE(local + 10), time)
    assert.equal(buf.readUInt16LE(local + 12), date)
    assert.equal(buf.readUInt32LE(local + 14), entries[k].crc)
    assert.equal(buf.readUInt32LE(local + 18), f.bytes.length)
    assert.equal(buf.readUInt32LE(local + 22), f.bytes.length)
    assert.equal(buf.readUInt16LE(local + 26), name.length)
    assert.equal(buf.readUInt16LE(local + 28), 0)
    assert.ok(buf.subarray(local + 30, local + 30 + name.length).equals(name))
    const data = buf.subarray(local + 30 + name.length, local + 30 + name.length + f.bytes.length)
    assert.ok(data.equals(Buffer.from(f.bytes)))
    assert.equal(crc32(new Uint8Array(data)), entries[k].crc)
  })
  assert.equal(p, end)

  // MOCKUP_ZIP_OUT=<file.zip> keeps a copy to open with another tool (Expand-Archive, unzip -t)
  if (process.env.MOCKUP_ZIP_OUT) fs.writeFileSync(process.env.MOCKUP_ZIP_OUT, buf)
})

test("makeZip refuses more entries than one ZIP holds", () => {
  const one = { name: "a.png", blob: new Blob([new Uint8Array(1)]), crc: 0 }
  assert.throws(() => makeZip(new Array(65536).fill(one)), /Too large for one ZIP/)
})

// --- New product wizard: placement maths, reducer, validation, file names ---------------------------
const uiStub = { slugify: (s) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }
const wiz = load("console/src/pages/mockup-studio/wizard/state.ts", (name) => (name.endsWith("mockup/layers") ? layersLib : name.endsWith("/ui") ? uiStub : {}))
const plain = (v) => JSON.parse(JSON.stringify(v))

test("the wizard's slug stub matches the console's slugify", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "console/src/ui.tsx"), "utf8")
  assert.ok(source.includes(`export const slugify = (s: string) => ${uiStub.slugify.toString().slice(7)}`))
})

test("a clamped placement always covers the whole print of every chosen model", () => {
  const A = layersLib.A_DEFAULT
  const portrait = { w: 1050, h: 1680 }
  assert.ok(wiz.limits(1, portrait, [A]).y === 0 && wiz.limits(1, portrait, [A]).x < 0.001, "a 5 : 8 design cannot move at 100%")
  assert.ok(Math.abs(wiz.limits(2, portrait, [A]).y - 0.5) < 1e-9)
  assert.ok(Math.abs(wiz.limits(1, { w: 2000, h: 1000 }, [A]).x - (2 * A - 1) / 2) < 1e-9, "a wide design moves sideways")
  const both = wiz.limits(1.5, portrait, [A, 1.3])
  assert.ok(both.x <= wiz.limits(1.5, portrait, [A]).x && both.x <= wiz.limits(1.5, portrait, [1.3]).x, "the tightest model wins")
  const c = wiz.clampPlacement({ zoom: 9, ox: 5, oy: -5 }, portrait, [A])
  assert.equal(c.zoom, 2.5)
  // cover check exactly as placeDesign draws: W = 1, H = A
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 300; k++) {
    const img = { w: 200 + Math.round(rnd() * 4000), h: 200 + Math.round(rnd() * 4000) }
    const As = [1.2 + rnd(), 1.2 + rnd()]
    const p = wiz.clampPlacement({ zoom: 0.5 + rnd() * 3, ox: rnd() * 4 - 2, oy: rnd() * 4 - 2 }, img, As)
    for (const a of As) {
      const W = 1, H = a, s = Math.max(W / img.w, H / img.h) * p.zoom
      const dw = img.w * s, dh = img.h * s
      const left = (W - dw) / 2 + p.ox * W, top = (H - dh) / 2 + p.oy * H
      assert.ok(left <= 1e-9 && left + dw >= W - 1e-9 && top <= 1e-9 && top + dh >= H - 1e-9, `white edge at ${JSON.stringify({ img, a, p })}`)
    }
  }
})

test("zooming about a point keeps the design point under it", () => {
  const p = { zoom: 1.2, ox: 0.05, oy: -0.1 }
  const a = { x: 0.3, y: 0.7 }
  const q = wiz.zoomAbout(p, 2, a)
  assert.equal(q.zoom, 2)
  assert.ok(Math.abs((a.x - (0.5 + p.ox)) / p.zoom - (a.x - (0.5 + q.ox)) / q.zoom) < 1e-12)
  assert.ok(Math.abs((a.y - (0.5 + p.oy)) / p.zoom - (a.y - (0.5 + q.oy)) / q.zoom) < 1e-12)
  assert.deepEqual(plain(wiz.zoomAbout(p, 2, null)), { zoom: 2, ox: 0.05, oy: -0.1 })
  assert.equal(wiz.placementKey({ zoom: 1.23456, ox: 0.000049, oy: -0.5 }), "1.235|0.0000|-0.5000")
  assert.deepEqual([wiz.sharpness(3200, 1), wiz.sharpness(3200, 1.2), wiz.sharpness(1980, 1)], [3, 2, 1])
  assert.equal(wiz.sharpness(wiz.across({ w: 3000, h: 4800 }, layersLib.A_DEFAULT), 1), 3, "a 3000 px wide 5 : 8 design is sharp")
})

test("the reducer: a new design names the product, picks a model and resets the placement", () => {
  const preview = { close() {} }
  const design = (name, version) => ({ file: { name, size: 1 }, url: `blob:${version}`, w: 1050, h: 1680, across: 1050, reduced: false, version, preview })
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "design/reading", name: "x.png" })
  assert.equal(s.reading, "x.png")
  s = wiz.reducer(s, { type: "place/apply", p: { zoom: 1.5, ox: 0.1, oy: 0 } })
  s = wiz.reducer(s, { type: "design/ready", design: design("muse_honey-glow 47.png", 1), firstDevice: { device: "iphone-18-pro-max", colour: "Black" } })
  assert.equal(s.reading, null)
  assert.equal(s.details.name, "Muse Honey Glow 47")
  assert.equal(s.details.slug, "muse-honey-glow-47")
  assert.deepEqual(plain(s.picks), { "iphone-18-pro-max": { on: true, colour: "Black" } })
  assert.deepEqual(plain(s.placement), { zoom: 1, ox: 0, oy: 0 })
  assert.equal(s.past.length, 0)
  // a typed title keeps its name on the next design; the slug follows the title until it is typed
  s = wiz.reducer(s, { type: "details", patch: { name: "Spring Bloom", nameTouched: true } })
  assert.equal(s.details.slug, "spring-bloom")
  s = wiz.reducer(s, { type: "design/ready", design: design("other.png", 2), firstDevice: null })
  assert.equal(s.details.name, "Spring Bloom")
  s = wiz.reducer(s, { type: "details", patch: { slug: "my-url", slugTouched: true } })
  s = wiz.reducer(s, { type: "details", patch: { name: "Changed" } })
  assert.equal(s.details.slug, "my-url")
  s = wiz.reducer(s, { type: "design/remove" })
  assert.equal(s.design, null)
  assert.equal(s.reached, 0)
})

test("the reducer: one gesture is one undo step, and undo walks back", () => {
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "place/begin" })
  for (const ox of [0.01, 0.02, 0.03]) s = wiz.reducer(s, { type: "place/set", p: { zoom: 1.2, ox, oy: 0 } })
  s = wiz.reducer(s, { type: "place/end" })
  assert.equal(s.past.length, 1)
  s = wiz.reducer(s, { type: "place/begin" })
  s = wiz.reducer(s, { type: "place/end" })
  assert.equal(s.past.length, 1, "a gesture that moved nothing adds no step")
  s = wiz.reducer(s, { type: "place/apply", p: { zoom: 1.3, ox: 0.03, oy: 0 } })
  s = wiz.reducer(s, { type: "place/reset" })
  assert.equal(s.past.length, 3)
  s = wiz.reducer(s, { type: "place/undo" })
  assert.equal(s.placement.zoom, 1.3)
  s = wiz.reducer(wiz.reducer(s, { type: "place/undo" }), { type: "place/undo" })
  assert.deepEqual(plain(s.placement), { zoom: 1, ox: 0, oy: 0 })
  assert.equal(wiz.reducer(s, { type: "place/undo" }), s, "nothing left to undo")
  for (let i = 0; i < 40; i++) s = wiz.reducer(s, { type: "place/apply", p: { zoom: 1 + (i + 1) / 100, ox: 0, oy: 0 } })
  assert.equal(s.past.length, 30)
})

test("the reducer: steps, picks and Make another", () => {
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "go", step: "details" })
  assert.equal(s.dir, 1); assert.equal(s.reached, 3)
  s = wiz.reducer(s, { type: "errors/show" })
  s = wiz.reducer(s, { type: "go", step: "models", fromReview: true })
  assert.equal(s.dir, -1); assert.equal(s.reached, 3); assert.equal(s.fromReview, true); assert.equal(s.showErrors, false)
  s = wiz.reducer(s, { type: "pick/toggle", device: "a", colour: "Black" })
  s = wiz.reducer(s, { type: "pick/colour", device: "b", colour: "Glacier" })
  assert.deepEqual(plain(s.picks), { a: { on: true, colour: "Black" }, b: { on: true, colour: "Glacier" } })
  assert.equal(s.focus.device, "b")
  s = wiz.reducer(s, { type: "pick/all", on: false, devices: [{ device: "a", colour: "Black" }, { device: "b", colour: "Black" }] })
  assert.deepEqual(plain(s.picks), { a: { on: false, colour: "Black" }, b: { on: false, colour: "Glacier" } }, "colours are kept")
  s = wiz.reducer(s, { type: "details", patch: { name: "X", stock: "5", status: "published", collection: wiz.NEW_COLLECTION, newCollection: "Spring", description: "d" } })
  s = wiz.reducer(s, { type: "background", value: "transparent" })
  s = wiz.reducer(s, { type: "again", collectionTitle: "Spring" })
  assert.equal(s.step, "design"); assert.equal(s.reached, 0); assert.equal(s.design, null)
  assert.deepEqual([s.details.name, s.details.slug, s.details.description], ["", "", ""])
  assert.deepEqual([s.details.stock, s.details.status, s.details.collection, s.details.newCollection], ["5", "published", "Spring", ""])
  assert.equal(s.background, "transparent")
  assert.equal(s.picks.b.colour, "Glacier")
})

test("validation names the first problem of each step", () => {
  const set = { device: "iphone-18-pro-max", base_url: "https://x", colours: ["Black"], default_colour: "Black", enabled: true }
  const ctx = (patch = {}) => ({ chosen: [set], metas: {}, colourOf: (x) => x.default_colour, slugState: "free", deviceName: () => "iPhone 18 Pro Max", ...patch })
  let s = wiz.initialState()
  let e = wiz.stepErrors(s, ctx({ chosen: [] }))
  assert.equal(e.design, "Add a design to continue.")
  assert.equal(e.models, "Choose at least one model to continue.")
  assert.equal(e.details, "Enter the product title.")
  assert.equal(e.placement, undefined)
  assert.equal(wiz.blockedBy(e, 1), "design")
  assert.equal(wiz.blockedBy(e, 0), null)
  e = wiz.stepErrors(s, ctx({ metas: { "iphone-18-pro-max|Black": { status: "error", message: "x" } } }))
  assert.equal(e.models, "iPhone 18 Pro Max's mockups could not be loaded. Untick it or press Retry.")
  s = wiz.reducer(s, { type: "details", patch: { name: "Bloom", slug: "Bad Slug", slugTouched: true, stock: "-1", collection: wiz.NEW_COLLECTION } })
  assert.deepEqual(plain(wiz.fieldErrors(s, "invalid")), {
    slug: "Use lowercase letters, numbers and dashes in the URL.", newCollection: "Enter the new collection's name.", stock: "Enter a whole number, 0 or more.",
  })
  s = wiz.reducer(s, { type: "details", patch: { slug: "bloom", stock: " 3 ", newCollection: "Spring" } })
  assert.equal(wiz.fieldErrors(s, "taken").slug, "This URL is already used by another design.")
  assert.deepEqual(plain(wiz.fieldErrors(s, "unknown")), {}, "an unchecked URL does not block")
})

test("validation keeps to the backend's limits: a 150-character URL and stock up to 10,000,000", () => {
  let s = wiz.initialState()
  // a long title makes a URL the backend takes: cut at 150, never ending in a dash
  s = wiz.reducer(s, { type: "details", patch: { name: `${"Spring bloom ".repeat(14)}x` } })
  assert.ok(s.details.slug.length <= 150 && wiz.slugValid(s.details.slug), s.details.slug)
  assert.equal(wiz.fieldErrors(s, "free").slug, undefined)
  s = wiz.reducer(s, { type: "details", patch: { slug: "a".repeat(151), slugTouched: true } })
  assert.equal(wiz.fieldErrors(s, "free").slug, "Keep the URL to 150 characters or fewer.")
  s = wiz.reducer(s, { type: "details", patch: { slug: "bloom", stock: "10000001" } })
  assert.equal(wiz.fieldErrors(s, "free").stock, "Enter a whole number from 0 to 10,000,000.")
  s = wiz.reducer(s, { type: "details", patch: { stock: "10000000" } })
  assert.equal(wiz.fieldErrors(s, "free").stock, undefined)
})

test("the reducer: a re-sent design gets a new version and keeps its placement; Remove ends an open pick", () => {
  const preview = { close() {} }
  let s = wiz.initialState()
  assert.equal(wiz.reducer(s, { type: "design/version", version: 9 }), s, "no design: nothing to renumber")
  s = wiz.reducer(s, { type: "design/ready", design: { file: { name: "a.png", size: 1 }, url: "blob:a", w: 1050, h: 1680, across: 1050, scale: 1, reduced: false, version: 1, preview }, firstDevice: null })
  s = wiz.reducer(s, { type: "place/apply", p: { zoom: 1.4, ox: 0.1, oy: 0 } })
  const before = s.design
  s = wiz.reducer(s, { type: "design/version", version: 2 })
  assert.equal(s.design.version, 2)
  assert.equal(s.design.url, before.url)
  assert.equal(s.design.preview, before.preview, "the same preview, so it is not closed")
  assert.deepEqual(plain(s.placement), { zoom: 1.4, ox: 0.1, oy: 0 })
  s = wiz.reducer(s, { type: "design/reading", name: "b.png" })
  s = wiz.reducer(s, { type: "design/remove" })
  assert.equal(s.reading, null)
})

test("download names, swatches and the time left", () => {
  assert.equal(wiz.baseName({ slug: "", name: "Muse Honey Glow" }), "muse-honey-glow")
  assert.equal(wiz.baseName({ slug: "", name: "" }, "My File.PNG"), "my-file")
  assert.equal(wiz.baseName({ slug: "", name: "" }), "mockup")
  assert.equal(wiz.pngName("muse-honey-glow", "iphone-18-pro-max", "Glacier", 5, "05 Camera close-up", 2400), "muse-honey-glow_iphone-18-pro-max_glacier_05-camera-close-up_2400.png")
  assert.equal(wiz.entryName(12, "12 Side buttons close-up", 1200), "12-side-buttons-close-up_1200.png")
  assert.equal(wiz.modelZipName("x", "iphone-17", "Wine Red"), "x_iphone-17_wine-red_mockups.zip")
  assert.equal(wiz.allZipName("x"), "x_mockups.zip")
  assert.equal(wiz.swatchColour("Wine Red"), "#6b1f2e")
  assert.match(wiz.swatchColour("Plasma Teal"), /^hsl\(\d+, 14%, 72%\)$/)
  assert.equal(wiz.swatchColour("Plasma Teal"), wiz.swatchColour("plasma teal"))
  assert.equal(wiz.etaText(1500, 30), "Less than a minute left")
  assert.equal(wiz.etaText(1500, 200), "About 5 min left")
  assert.equal(wiz.titleFromFile("Muse_Honey Glow-47.jpg"), "Muse Honey Glow 47")
})

// --- Publish: the same server path as before (POST /admin/designs/upload per picture, then /admin/designs/custom) ---
class ApiErrorStub extends Error { constructor(message, status) { super(message); this.status = status } }

// One publishProduct run against recorded stubs: the URL check (fetch), the posts and the export worker.
function publishHarness({ checkStatus = 404, sizes = [600, 1200, 2400], mime = "image/webp", stopAfter = Infinity, customError = null, patch = {}, models } = {}) {
  const log = [], webps = []
  let uploads = 0
  const post = async (url, body) => {
    log.push(["post", url, body])
    if (url.endsWith("/custom") && customError) throw customError
    if (url.endsWith("/upload")) { uploads++; return { url: `u${uploads}` } }
    return { result: { design: body.slug } }
  }
  const stubs = {
    "../../../api": { post, ApiError: ApiErrorStub },
    "../../../mockup/layers": {
      loadMeta: async () => ({ sizes, shots: [1, 2, 3, 13].map((n) => ({ n, name: `${n} Shot` })) }),
      pickSize: layersLib.pickSize, designWidthFor: layersLib.designWidthFor, blobToBase64: async () => "x", shotLabel: layersLib.shotLabel,
    },
    "./engine": { cellKey: (d, c, s, v) => `${d}|${c}|${s}|${v}` },
    "./state": { etaText: wiz.etaText, NEW_COLLECTION: wiz.NEW_COLLECTION },
    "../../../ui": { toast() {} },
    "../../../mockup/zip": {},
  }
  const lib = load("console/src/pages/mockup-studio/wizard/export.ts", (name) => stubs[name] ?? assert.fail(`unexpected import ${name}`), {
    fetch: async (url) => { log.push(["fetch", url]); return { ok: checkStatus === 200, status: checkStatus } }, performance,
  })
  const ex = { bump: () => 1, webp: async (job) => { webps.push(job); return { blob: new Blob(["a"]), mime } } }
  const run = () => lib.publishProduct({
    settings: { case_type: "signature", shots: [1, 2, 3], image_size: 1200, quality: 92, supersample: true, sets: [] },
    models: models ?? [{ set: { device: "iphone-18-pro-max", base_url: "https://x" }, colour: "Black", model: "iPhone 18 Pro Max" }],
    details: { name: " Bloom ", slug: "bloom", description: "d", status: "draft", collection: wiz.NEW_COLLECTION, newCollection: " Spring ", stock: "5" },
    placement: { zoom: 1, ox: 0, oy: 0 }, version: 1, hq: 4096, lowMemory: false, exporter: async () => ex,
    stopped: () => uploads >= stopAfter, onJob() {}, onUploaded() {}, onMilestone() {}, ...patch,
  })
  return { log, webps, run, uploads: () => log.filter((e) => e[1] === "/admin/designs/upload").map((e) => e[2]) }
}

test("publishing checks the URL first, then uploads every gallery picture and creates the product with the same body", async () => {
  const h = publishHarness()
  const result = await h.run()
  assert.equal(h.log[0][0], "fetch", "the URL check comes before any upload")
  const ups = h.uploads()
  assert.equal(ups.length, 3)
  for (const body of ups) assert.deepEqual(Object.keys(body), ["designSlug", "caseTypeSlug", "deviceSlug", "index", "filename", "mimeType", "contentBase64"])
  assert.deepEqual(ups.map((b) => [b.index, b.filename, b.mimeType]), [[1, "1.webp", "image/webp"], [2, "2.webp", "image/webp"], [3, "3.webp", "image/webp"]])
  const custom = h.log.filter((e) => e[1] === "/admin/designs/custom")
  assert.equal(custom.length, 1)
  assert.equal(h.log.at(-1), custom[0], "the product is created last")
  assert.deepEqual(plain(custom[0][2]), {
    name: "Bloom", slug: "bloom", description: "d", theme: "Spring", status: "draft", blankStock: 5,
    pairs: { signature: { "iphone-18-pro-max": ["u1", "u2", "u3"] } },
  })
  // sharper shop images: the 2400 px renders with the full design width, shrunk to the image size
  assert.deepEqual(h.webps.map((j) => [j.size, j.out, j.width, j.quality]), [[2400, 1200, 4096, 92], [2400, 1200, 4096, 92], [2400, 1200, 4096, 92]])
  assert.deepEqual(plain(result), { slug: "bloom", perModel: 3 })
})

test("publishing makes the shop images at 1200 where 2400 is not uploaded or the device is short of memory", async () => {
  const missing = publishHarness({ models: [{ set: { device: "iphone-17", base_url: "https://y" }, colour: "Black", model: "iPhone 17", full: false }] })
  await missing.run()
  assert.deepEqual(missing.webps.map((j) => [j.size, j.width]), [[1200, 2048], [1200, 2048], [1200, 2048]])
  const phone = publishHarness({ patch: { lowMemory: true } })
  await phone.run()
  assert.deepEqual(phone.webps.map((j) => [j.size, j.out, j.width]), [[1200, undefined, 2048], [1200, undefined, 2048], [1200, undefined, 2048]])
})

test("a taken URL or a failed check uploads nothing", async () => {
  for (const status of [200, 500]) {
    const h = publishHarness({ checkStatus: status })
    await assert.rejects(h.run(), status === 200 ? { name: "Taken" } : /Couldn't check the URL \(500\)/)
    assert.equal(h.log.filter((e) => e[0] === "post").length, 0)
    assert.equal(h.webps.length, 0)
  }
})

test("Safari's JPEG shop images upload as .jpg, and Stop creates no product", async () => {
  const jpeg = publishHarness({ mime: "image/jpeg" })
  await jpeg.run()
  assert.deepEqual(jpeg.uploads().map((b) => [b.filename, b.mimeType]), [["1.jpg", "image/jpeg"], ["2.jpg", "image/jpeg"], ["3.jpg", "image/jpeg"]])
  for (const stopAfter of [0, 1, 3]) {
    const h = publishHarness({ stopAfter })
    await assert.rejects(h.run(), { name: "Stopped" })
    assert.equal(h.log.filter((e) => e[1] === "/admin/designs/custom").length, 0, `stopped after ${stopAfter} uploads`)
  }
})

test("a create request that got no answer may have created the product; a refused one did not", async () => {
  const timeout = new Error("The server took too long. Refresh before retrying; the save may have completed.")
  await assert.rejects(publishHarness({ customError: timeout }).run(), (e) => e === timeout && e.maybeCreated === true)
  const gateway = new ApiErrorStub("Bad gateway", 502)
  await assert.rejects(publishHarness({ customError: gateway }).run(), (e) => e.maybeCreated === true)
  const refused = new ApiErrorStub("Invalid", 400)
  await assert.rejects(publishHarness({ customError: refused }).run(), (e) => e === refused && !e.maybeCreated)
})
