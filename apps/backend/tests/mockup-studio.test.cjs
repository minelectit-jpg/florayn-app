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
const { composite, prepareDesign, denoiseBlur, SHARPNESS, BLUR_NOISE } = compositor
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

test("the sharpness defaults are the ones matched to the Blender renders (2026-10-17, corrected blur layers)", () => {
  assert.deepEqual({ ...SHARPNESS }, { blurScale: 2, lodBias: -0.5 })
  assert.equal(BLUR_NOISE, 4e-4)
  // out of focus (blur byte 91 = 0.2 mm), where blurScale matters: the defaults are 2 and -0.5, not 2026-10-16's 1.5
  let seed = 11
  const noise = Array.from({ length: 1024 * 3 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24)
  const busy = prepareDesign(noise, 1024, 1, 3, 1)
  const wide = { template_mm: [100, 100], ink_saturation: 1 }
  const L = layersFor([
    { u: 0.3, v: 0.5, static: 0, light: 0.5, alpha: 1, mask: 1 },
    { u: 0.3 + 1 / 1024, v: 0.5, static: 0, light: 0.5, alpha: 1, mask: 1 },
  ])
  L.blur.fill(91)
  const shipped = [...composite(L, wide, busy)]
  assert.deepEqual(shipped, [...composite(L, wide, busy, { blurScale: 2, lodBias: -0.5 })])
  assert.notDeepEqual(shipped, [...composite(L, wide, busy, { blurScale: 1.5, lodBias: -0.5 })])
})

test("the blur layer's float32 rounding is taken off: in focus stays sharp, depth of field still blurs", () => {
  // 1 px black and white stripes, 4096 px across a 100 mm template (40.96 px/mm); two print pixels one design pixel apart
  const W = 4096
  const stripes = prepareDesign(Array.from({ length: W * 3 }, (_, k) => ((k / 3 | 0) % 2 ? 0 : 255)), W, 1, 3, 1)
  const wide = { template_mm: [100, 100], ink_saturation: 1 }
  const pair = (u0, v) => layersFor([
    { u: (u0 + 0.5) / W, v, static: 0, light: 0.5, alpha: 1, mask: 1 },
    { u: (u0 + 1.5) / W, v, static: 0, light: 0.5, alpha: 1, mask: 1 },
  ])
  const run = (L, b) => { L.blur.fill(b); return [...composite(L, wide, stripes)] }
  // blur byte 33 = 0.025 mm: under the floor at the template centre (4e-4 x |(50, 50) mm| = 0.028 mm) -> the sharp level
  const mid = pair(2048, 0.5)
  const sharpMid = run(mid, 0)
  assert.ok(sharpMid[0] > 150 && sharpMid[4] < 30, `white and black stripes ${sharpMid}`)
  assert.deepEqual(run(mid, 33), sharpMid)
  // the floor grows with |uv|: at the corner (u, v near 0) the same 0.025 mm is kept and blurs the stripes
  const corner = pair(0, 0)
  assert.notDeepEqual(run(corner, 33), run(corner, 0))
  // real depth of field (byte 91 = 0.2 mm) blurs at the centre too: both pixels close to the same grey
  const dof = run(mid, 91)
  assert.ok(Math.abs(dof[0] - dof[4]) < 20 && dof[0] > 90 && dof[0] < 160, `grey ${dof}`)
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

test("loadLayers puts the blur layer through denoiseBlur once, at load (the 5x5 median stays on)", async () => {
  const w = 5, h = 5, n = w * h
  // each layer file decodes to one grey value; all print (aux 255); one speck in the middle of the blur layer
  const grey = { static: 20, light: 40, uv: 60, aux: 255, blur: 10 }
  const pixels = (layer) => {
    const px = new Uint8ClampedArray(n * 4).map((_, k) => (k % 4 === 3 ? 255 : grey[layer]))
    if (layer === "blur") px[12 * 4] = 200
    return px
  }
  const fetched = []
  const lib = load("console/src/mockup/layers.ts", (name) => (name === "./compositor" ? compositor : {}), {
    fetch: async (url) => {
      fetched.push(url)
      return { ok: true, status: 200, blob: async () => ({ layer: decodeURIComponent(url.split("/").pop()).replace(/^\d+ |\.png$/g, "") }) }
    },
    createImageBitmap: async (blob) => ({ width: w, height: h, px: pixels(blob.layer), close() {} }),
    OffscreenCanvas: class {
      constructor(cw, ch) { this.width = cw; this.height = ch }
      getContext() { const canvas = this; return { drawImage(bmp) { canvas.px = bmp.px }, getImageData() { return { data: canvas.px } } } }
    },
  })
  const L = await lib.loadLayers("https://img.test/set", "Black", 600, 3)
  assert.equal(fetched.length, 5)
  assert.ok(fetched.includes("https://img.test/set/Black/600/03%20blur.png"))
  assert.deepEqual([L.w, L.h, L.static[0], L.light[0], L.uv[0], L.aux[2]], [5, 5, 20, 40, 60, 255])
  const raw = new Uint8Array(n).fill(10)
  raw[12] = 200
  assert.equal(L.blur[12], 10, "the speck is gone")
  assert.deepEqual([...L.blur], [...denoiseBlur(raw, L.aux, w, h)])
  assert.equal(await lib.loadLayers("https://img.test/set", "Black", 600, 3), L, "cached: not decoded or filtered again")
  assert.equal(fetched.length, 5)
})

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
  s = wiz.reducer(s, { type: "design/ready", design: design("muse_honey-glow 47.png", 1), firstDevice: { device: "iphone-18-pro-max", colours: ["Black", "Silver"], default_colour: "Black" } })
  assert.equal(s.reading, null)
  assert.equal(s.details.name, "Muse Honey Glow 47")
  assert.equal(s.details.slug, "muse-honey-glow-47")
  assert.deepEqual(plain(s.picks), { "iphone-18-pro-max": { on: true, colours: ["Black", "Silver"], stage: "Black" } }, "every colour is pre-selected")
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
  assert.equal(s.dir, 1); assert.equal(s.reached, 2) // Design (with placement), Models, Details
  s = wiz.reducer(s, { type: "errors/show" })
  s = wiz.reducer(s, { type: "go", step: "models", fromReview: true })
  assert.equal(s.dir, -1); assert.equal(s.reached, 2); assert.equal(s.fromReview, true); assert.equal(s.showErrors, false)
  const A = { device: "a", colours: ["Black"], default_colour: "Black" }
  const B = { device: "b", colours: ["Black", "Silver", "Glacier"], default_colour: "Black" }
  s = wiz.reducer(s, { type: "pick/toggle", set: A })
  s = wiz.reducer(s, { type: "pick/all-colours", on: false, sets: [] }) // Main only: newly chosen models start with the main colour
  s = wiz.reducer(s, { type: "pick/colour", set: B, colour: "Glacier" })
  assert.deepEqual(plain(s.picks), { a: { on: true, colours: ["Black"], stage: "Black" }, b: { on: true, colours: ["Black", "Glacier"], stage: "Glacier" } })
  assert.equal(s.focus.device, "b")
  s = wiz.reducer(s, { type: "pick/all", on: false, sets: [A, B] })
  assert.deepEqual(plain(s.picks), { a: { on: false, colours: ["Black"], stage: "Black" }, b: { on: false, colours: ["Black", "Glacier"], stage: "Glacier" } }, "colours are kept")
  s = wiz.reducer(s, { type: "pick/all", on: true, sets: [B] })
  assert.deepEqual(plain(s.picks.b), { on: true, colours: ["Black", "Glacier"], stage: "Glacier" }, "back on with its colours")
  s = wiz.reducer(s, { type: "pick/all", on: false, sets: [A, B] })
  s = wiz.reducer(s, { type: "details", patch: { name: "X", stock: "5", status: "published", collection: wiz.NEW_COLLECTION, newCollection: "Spring", description: "d" } })
  s = wiz.reducer(s, { type: "background", value: "transparent" })
  s = wiz.reducer(s, { type: "again", collectionTitle: "Spring" })
  assert.equal(s.step, "design"); assert.equal(s.reached, 0); assert.equal(s.design, null)
  assert.deepEqual([s.details.name, s.details.slug, s.details.description], ["", "", ""])
  assert.deepEqual([s.details.stock, s.details.status, s.details.collection, s.details.newCollection], ["5", "published", "Spring", ""])
  assert.equal(s.background, "transparent")
  assert.deepEqual(plain(s.picks.b.colours), ["Black", "Glacier"])
  assert.equal(s.colourMode, "main", "Make another keeps the colour mode")
  assert.equal(s.details.mode, "new")
})

// --- phone colours: multi-colour picks (PHONE_COLOURS.md) -------------------------------------------------
const P18 = { device: "iphone-18-pro-max", base_url: "https://x", colours: ["Black", "Silver", "Wine Red", "Glacier"], default_colour: "Black", enabled: true }

test("phone colours: a newly ticked model gets every colour (or the main only), and the last colour cannot be unticked", () => {
  let s = wiz.initialState()
  assert.equal(s.colourMode, "all", "Studio pre-selects all colours")
  s = wiz.reducer(s, { type: "pick/toggle", set: P18 })
  assert.deepEqual(plain(s.picks[P18.device]), { on: true, colours: ["Black", "Silver", "Wine Red", "Glacier"], stage: "Black" })
  // tapping a ticked chip unticks it; the staged colour falls back to the main one
  s = wiz.reducer(s, { type: "pick/stage", set: P18, colour: "Silver" })
  s = wiz.reducer(s, { type: "pick/colour", set: P18, colour: "Silver" })
  assert.deepEqual(plain(s.picks[P18.device]), { on: true, colours: ["Black", "Wine Red", "Glacier"], stage: "Black" })
  s = wiz.reducer(s, { type: "pick/stage", set: P18, colour: "Glacier" })
  s = wiz.reducer(s, { type: "pick/colour", set: P18, colour: "Black" })
  assert.equal(s.picks[P18.device].stage, "Glacier", "an untick that is not the staged colour keeps the stage")
  s = wiz.reducer(s, { type: "pick/colour", set: P18, colour: "Glacier" })
  assert.deepEqual(plain(s.picks[P18.device]), { on: true, colours: ["Wine Red"], stage: "Wine Red" })
  const last = wiz.reducer(s, { type: "pick/colour", set: P18, colour: "Wine Red" })
  assert.equal(last, s, "the last ticked colour stays")
  // the toolbar: All colours ticks every colour of every chosen model, Main only keeps the main one
  s = wiz.reducer(s, { type: "pick/all-colours", on: true, sets: [P18] })
  assert.deepEqual(plain(s.picks[P18.device].colours), P18.colours)
  assert.equal(s.picks[P18.device].stage, "Wine Red")
  s = wiz.reducer(s, { type: "pick/all-colours", on: false, sets: [P18] })
  assert.deepEqual(plain(s.picks[P18.device]), { on: true, colours: ["Black"], stage: "Black" })
  assert.equal(s.colourMode, "main")
  // a model chosen now starts with its main colour; toggling off and on keeps the colours
  const P17 = { ...P18, device: "iphone-17", default_colour: "Silver" }
  s = wiz.reducer(s, { type: "pick/toggle", set: P17 })
  assert.deepEqual(plain(s.picks[P17.device]), { on: true, colours: ["Silver"], stage: "Silver" })
  s = wiz.reducer(wiz.reducer(s, { type: "pick/colour", set: P17, colour: "Glacier" }), { type: "pick/toggle", set: P17 })
  s = wiz.reducer(s, { type: "pick/toggle", set: P17 })
  assert.deepEqual(plain(s.picks[P17.device].colours), ["Silver", "Glacier"])
  // a chip on a model that is not chosen chooses it, with that colour ticked and shown
  const P16 = { ...P18, device: "iphone-16" }
  s = wiz.reducer(s, { type: "pick/colour", set: P16, colour: "Glacier" })
  assert.deepEqual(plain(s.picks[P16.device]), { on: true, colours: ["Black", "Glacier"], stage: "Glacier" })
  assert.equal(wiz.reducer(s, { type: "pick/colour", set: P16, colour: "Pink" }), s, "a colour the set does not have is ignored")
})

test("phone colours: the stage shows a colour without ticking it, and pickOf checks a pick against the live set", () => {
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "pick/stage", set: P18, colour: "Silver" })
  assert.deepEqual(plain(s.picks[P18.device]), { on: false, colours: [], stage: "Silver" })
  assert.deepEqual(plain(wiz.pickOf(s, P18)), { on: false, colours: P18.colours, stage: "Silver" }, "never chosen: the colour mode's colours")
  s = wiz.reducer(s, { type: "pick/toggle", set: P18 })
  assert.equal(s.picks[P18.device].stage, "Black", "first time on: the stage shows the default colour")
  s = wiz.reducer(s, { type: "pick/stage", set: P18, colour: "Glacier" })
  assert.deepEqual(plain(s.picks[P18.device].colours), P18.colours, "staging ticks nothing")
  assert.equal(s.picks[P18.device].stage, "Glacier")
  // the set loses colours (a new layer version): ticked ones are filtered, the stage falls back to the main colour
  const fewer = { ...P18, colours: ["Black", "Silver"] }
  assert.deepEqual(plain(wiz.pickOf(s, fewer)), { on: true, colours: ["Black", "Silver"], stage: "Black" })
  const none = { ...P18, colours: ["Desert"], default_colour: "Desert" }
  assert.deepEqual(plain(wiz.pickOf(s, none)), { on: true, colours: ["Desert"], stage: "Desert" }, "never empty: the default colour")
  // palette order, whatever order they were ticked in
  const t = { picks: { [P18.device]: { on: true, colours: ["Glacier", "Silver"], stage: "Silver" } }, colourMode: "all" }
  assert.deepEqual(plain(wiz.pickOf(t, P18).colours), ["Silver", "Glacier"])
})

test("phone colours: the main colour, publishing order and the shots every colour shares", () => {
  assert.equal(wiz.mainColourOf(P18, { colours: ["Silver", "Black"] }), "Black", "the default when ticked")
  assert.equal(wiz.mainColourOf(P18, { colours: ["Glacier", "Silver"] }), "Silver", "else the first ticked in palette order")
  assert.deepEqual(plain(wiz.colourOrder(P18, { colours: ["Glacier", "Black", "Silver"] })), ["Black", "Silver", "Glacier"])
  assert.deepEqual(plain(wiz.colourOrder(P18, { colours: ["Glacier", "Silver"] })), ["Silver", "Glacier"])
  const meta = (ns) => ({ shots: ns.map((n) => ({ n })) })
  assert.deepEqual(plain(wiz.sharedShots([1, 2, 3, 13], [meta([1, 2, 3, 13, 14]), meta([1, 3, 13])])), [1, 3, 13])
  assert.deepEqual(plain(wiz.sharedShots([2, 1], [meta([1, 2])])), [2, 1], "gallery order")
  assert.deepEqual(plain(wiz.sharedShots([1], [meta([1]), meta([2])])), [])
  assert.deepEqual(plain(wiz.anglesOf(meta([1, 2, 3, 14]), [3, 1])), [3, 1, 2, 14])
  assert.equal(wiz.colourList(["Black", "Silver", "Glacier"]), "Black (main) · Silver · Glacier")
})

test("phone colours: the estimate, the swatch hex the shop shows, and the ZIP names", () => {
  assert.equal(wiz.publishEstimate({ models: 39, colourSets: 117, pictures: 1521, imageSize: 1200 }), "39 models · 117 colour sets · 1,521 pictures · about 71 MB · about 25 min")
  assert.equal(wiz.publishEstimate({ models: 1, colourSets: 1, pictures: 13, imageSize: 1200 }), "1 model · 1 colour set · 13 pictures · about 1 MB · under a minute")
  assert.equal(wiz.swatchHex({ ...P18, swatches: { Silver: "#AABBCC" } }, "Silver"), "#aabbcc", "the saved hex, lower-case")
  assert.equal(wiz.swatchHex(P18, "Silver"), "#e3e4e5", "else the SWATCH suggestion")
  assert.equal(wiz.swatchHex(P18, "Plasma Teal"), wiz.NEUTRAL_SWATCH, "else the shop's neutral grey")
  assert.equal(wiz.swatchHex({ ...P18, swatches: { Silver: "red" } }, "Silver"), "#e3e4e5", "an invalid saved value is ignored")
  assert.equal(wiz.dotColour({ ...P18, swatches: { Glacier: "#112233" } }, "Glacier"), "#112233")
  assert.equal(wiz.dotColour(P18, "Plasma Teal"), wiz.swatchColour("Plasma Teal"))
  // own keys only: "constructor" is on every plain object
  assert.equal(wiz.swatchHex({ ...P18, colours: ["Constructor"] }, "Constructor"), wiz.NEUTRAL_SWATCH)
  assert.match(wiz.swatchColour("Constructor"), /^hsl\(\d+, 14%, 72%\)$/)
  assert.equal(wiz.modelZipName("x", "iphone-18-pro-max", null), "x_iphone-18-pro-max_mockups.zip", "several colours")
  assert.equal(wiz.zipFolder("iphone-18-pro-max", "Wine Red"), "iphone-18-pro-max_wine-red/")
  assert.equal(wiz.plural(1521, "picture"), "1,521 pictures")
})

test("Update pictures: the mode keeps its URL, checks only the URL, and another URL is a new product again", () => {
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "details", patch: { name: "Muse", slug: "muse", slugTouched: true } })
  s = wiz.reducer(s, { type: "details", patch: { mode: "update", slugTouched: true } })
  assert.equal(s.details.mode, "update")
  s = wiz.reducer(s, { type: "details", patch: { name: "" } })
  assert.deepEqual(plain(wiz.fieldErrors(s, "taken")), {}, "an existing URL is what update needs; the title is the design's own")
  assert.equal(wiz.fieldErrors(s, "free").slug, "No design uses this URL. Make a new product instead.")
  const ctx = { chosen: [], metas: {}, slugState: "taken", deviceName: () => "", existingError: "Loading the design…" }
  assert.equal(wiz.stepErrors(s, ctx).details, "Loading the design…")
  assert.equal(wiz.stepErrors(s, { ...ctx, existingError: undefined }).details, undefined)
  s = wiz.reducer(s, { type: "details", patch: { slug: "muse-2" } })
  assert.equal(s.details.mode, "new", "another URL is another design")
  assert.equal(wiz.stepErrors(s, ctx).details, "Enter the product title.")
})

test("validation names the first problem of each step", () => {
  const set = { device: "iphone-18-pro-max", base_url: "https://x", colours: ["Black", "Silver"], default_colour: "Black", enabled: true }
  const ctx = (patch = {}) => ({ chosen: [set], metas: {}, slugState: "free", deviceName: () => "iPhone 18 Pro Max", ...patch })
  let s = wiz.initialState()
  let e = wiz.stepErrors(s, ctx({ chosen: [] }))
  assert.equal(e.design, "Add a design to continue.")
  assert.equal(e.models, "Choose at least one model to continue.")
  assert.equal(e.details, "Enter the product title.")
  assert.equal(e.placement, undefined)
  assert.equal(wiz.blockedBy(e, 1), "design")
  assert.equal(wiz.blockedBy(e, 0), null)
  // every ticked colour's layer info is checked (all colours are ticked by default)
  e = wiz.stepErrors(s, ctx({ metas: { "iphone-18-pro-max|Black": { status: "ready" }, "iphone-18-pro-max|Silver": { status: "error", message: "x" } } }))
  assert.equal(e.models, "iPhone 18 Pro Max · Silver: mockups couldn't be loaded. Untick it or press Retry.")
  const mainOnly = wiz.reducer(wiz.reducer(s, { type: "pick/toggle", set }), { type: "pick/all-colours", on: false, sets: [set] })
  assert.equal(wiz.stepErrors(mainOnly, ctx({ metas: { "iphone-18-pro-max|Silver": { status: "error", message: "x" } } })).models, undefined, "an unticked colour does not block")
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

// --- Publish: the Product Manager's server path (POST /admin/designs/upload per picture, then /admin/designs/custom
// or, for Update pictures, manager-variants and /pairs; then one /admin/designs/:slug/colours per model) ---------
// vm-made values (another realm): compare their JSON
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message)
class ApiErrorStub extends Error { constructor(message, status) { super(message); this.status = status } }

const BLACK = { name: "Black", slug: "black", main: true }
const SILVER = { name: "Silver", slug: "silver", main: false }
const GLACIER = { name: "Glacier", slug: "glacier", main: false }
const model = (device, name, colours = [BLACK]) => ({ set: { device, base_url: `https://x/${device}` }, model: name, colours })
const m18 = (colours) => model("iphone-18-pro-max", "iPhone 18 Pro Max", colours)
const m17 = (colours) => model("iphone-17", "iPhone 17", colours)

// One publishProduct run against recorded stubs: the URL check (fetch), the posts and the export worker.
// shotsOf(colour): the meta shots of a colour; failPost(url, body, log): an error to throw for that post, if any.
function publishHarness({ checkStatus = 404, checkBody = null, sizes = [600, 1200, 2400], shotsOf = () => [1, 2, 3, 13], mime = "image/webp", stopAfter = Infinity, stopWhen = null, customError = null, failPost = null, patch = {}, models } = {}) {
  const log = [], webps = [], jobs = []
  let uploads = 0
  const post = async (url, body) => {
    log.push(["post", url, body])
    const fail = failPost?.(url, body, log)
    if (fail) throw fail
    if (url.endsWith("/custom") && customError) throw customError
    if (url.endsWith("/upload")) { uploads++; return { url: `u${uploads}` } }
    if (url.endsWith("/custom")) return { result: { design: body.slug } }
    return { ok: true }
  }
  const stubs = {
    "../../../api": { post, ApiError: ApiErrorStub },
    "../../../mockup/layers": {
      loadMeta: async (base, colour) => ({ sizes, shots: shotsOf(colour).map((n) => ({ n, name: `${n} Shot` })) }),
      pickSize: layersLib.pickSize, designWidthFor: layersLib.designWidthFor, blobToBase64: async () => "x", shotLabel: layersLib.shotLabel,
    },
    "./engine": { cellKey: (d, c, s, v) => `${d}|${c}|${s}|${v}` },
    "./state": wiz,
    "../../../ui": { toast() {} },
    "../../../mockup/zip": {},
  }
  const lib = load("console/src/pages/mockup-studio/wizard/export.ts", (name) => stubs[name] ?? assert.fail(`unexpected import ${name}`), {
    fetch: async (url) => { log.push(["fetch", url]); return { ok: checkStatus === 200, status: checkStatus, json: async () => checkBody } }, performance,
  })
  const ex = { bump: () => 1, webp: async (job) => { webps.push(job); return { blob: new Blob(["a"]), mime } } }
  const run = () => lib.publishProduct({
    settings: { case_type: "signature", shots: [1, 2, 3], image_size: 1200, quality: 92, supersample: true, sets: [] },
    models: models ?? [m18()],
    details: { name: " Bloom ", slug: "bloom", description: "d", status: "draft", collection: wiz.NEW_COLLECTION, newCollection: " Spring ", stock: "5", mode: "new" },
    placement: { zoom: 1, ox: 0, oy: 0 }, version: 1, hq: 4096, lowMemory: false, exporter: async () => ex,
    stopped: () => (stopWhen ? stopWhen(log) : uploads >= stopAfter), onJob: (j) => jobs.push(j), onUploaded() {}, onMilestone() {}, ...patch,
  })
  const posts = (re) => log.filter((e) => e[0] === "post" && re.test(e[1]))
  return { lib, log, webps, jobs, run, posts, uploads: () => posts(/\/admin\/designs\/upload$/).map((e) => e[2]) }
}

test("publishing checks the URL first, then uploads every gallery picture and creates the product with the same body", async () => {
  const h = publishHarness()
  const result = await h.run()
  assert.equal(h.log[0][0], "fetch", "the URL check comes before any upload")
  const ups = h.uploads()
  assert.equal(ups.length, 3)
  for (const body of ups) same(Object.keys(body), ["designSlug", "caseTypeSlug", "deviceSlug", "colourSlug", "index", "filename", "mimeType", "contentBase64"])
  same(ups.map((b) => [b.colourSlug, b.index, b.filename, b.mimeType]), [["black", 1, "1.webp", "image/webp"], ["black", 2, "2.webp", "image/webp"], ["black", 3, "3.webp", "image/webp"]])
  const custom = h.posts(/\/custom$/)
  assert.equal(custom.length, 1)
  same(custom[0][2], {
    name: "Bloom", slug: "bloom", description: "d", theme: "Spring", status: "draft", blankStock: 5,
    pairs: { signature: { "iphone-18-pro-max": ["u1", "u2", "u3"] } },
  })
  // after the product: one colours call, even for a model in one colour (only the main colour marker)
  const colours = h.posts(/\/colours$/)
  assert.equal(h.log.indexOf(custom[0]) < h.log.indexOf(colours[0]), true, "the colours come after the product")
  assert.equal(h.log.at(-1), colours[0])
  assert.equal(colours[0][1], "/admin/designs/bloom/colours")
  same(colours[0][2], { source: "mockup_studio", variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "black", galleries: {}, replace: true }] })
  // sharper shop images: the 2400 px renders with the full design width, shrunk to the image size
  same(h.webps.map((j) => [j.size, j.out, j.width, j.quality]), [[2400, 1200, 4096, 92], [2400, 1200, 4096, 92], [2400, 1200, 4096, 92]])
  same({ ...result, steps: result.steps.length }, { slug: "bloom", perModel: 3, pictures: 3, steps: 1, failure: null })
})

test("publishing makes the shop images at 1200 where 2400 is not uploaded or the device is short of memory", async () => {
  const missing = publishHarness({ models: [m17([{ ...BLACK, full: false }])] })
  await missing.run()
  same(missing.webps.map((j) => [j.size, j.width]), [[1200, 2048], [1200, 2048], [1200, 2048]])
  const phone = publishHarness({ patch: { lowMemory: true } })
  await phone.run()
  same(phone.webps.map((j) => [j.size, j.out, j.width]), [[1200, undefined, 2048], [1200, undefined, 2048], [1200, undefined, 2048]])
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
  same(jpeg.uploads().map((b) => [b.filename, b.mimeType]), [["1.jpg", "image/jpeg"], ["2.jpg", "image/jpeg"], ["3.jpg", "image/jpeg"]])
  for (const stopAfter of [0, 1, 3]) {
    const h = publishHarness({ stopAfter, models: [m18([BLACK, SILVER])] })
    await assert.rejects(h.run(), { name: "Stopped" })
    assert.equal(h.posts(/\/(custom|colours)$/).length, 0, `stopped after ${stopAfter} uploads`)
  }
})

test("a create request that got no answer may have created the product; a refused one did not", async () => {
  const timeout = new Error("The server took too long. Refresh before retrying; the save may have completed.")
  const h = publishHarness({ customError: timeout })
  await assert.rejects(h.run(), (e) => e === timeout && e.maybeCreated === true)
  assert.equal(h.posts(/\/colours$/).length, 0, "no colours for a product that may not exist")
  const gateway = new ApiErrorStub("Bad gateway", 502)
  await assert.rejects(publishHarness({ customError: gateway }).run(), (e) => e.maybeCreated === true)
  const refused = new ApiErrorStub("Invalid", 400)
  await assert.rejects(publishHarness({ customError: refused }).run(), (e) => e === refused && !e.maybeCreated)
})

test("several phone colours: main first, the shots every colour has, colour folders, /custom with the main only, one /colours per model", async () => {
  // Glacier has no shot 3, so every colour of that model uses shots 1 and 2
  const h = publishHarness({ shotsOf: (c) => (c === "Glacier" ? [1, 2, 13] : [1, 2, 3, 13]), models: [m18([SILVER, BLACK, GLACIER]), m17()] })
  const result = await h.run()
  same(h.uploads().map((b) => [b.deviceSlug, b.colourSlug, b.index]), [
    ["iphone-18-pro-max", "black", 1], ["iphone-18-pro-max", "black", 2], ["iphone-18-pro-max", "silver", 1], ["iphone-18-pro-max", "silver", 2],
    ["iphone-18-pro-max", "glacier", 1], ["iphone-18-pro-max", "glacier", 2], ["iphone-17", "black", 1], ["iphone-17", "black", 2], ["iphone-17", "black", 3],
  ])
  same(h.webps.map((j) => [j.colour, j.shot]).slice(0, 6), [["Black", 1], ["Black", 2], ["Silver", 1], ["Silver", 2], ["Glacier", 1], ["Glacier", 2]])
  assert.ok(h.jobs.some((j) => j.label === "Making iPhone 18 Pro Max · Silver · picture 1 of 2"))
  same(h.posts(/\/custom$/)[0][2].pairs, { signature: { "iphone-18-pro-max": ["u1", "u2"], "iphone-17": ["u7", "u8", "u9"] } }, "the same /custom body as before: main colours only")
  same(h.posts(/\/colours$/).map((e) => plain(e[2])), [
    { source: "mockup_studio", variants: [{ caseType: "signature", device: "iphone-18-pro-max", main: "black", galleries: { silver: ["u3", "u4"], glacier: ["u5", "u6"] }, replace: true }] },
    { source: "mockup_studio", variants: [{ caseType: "signature", device: "iphone-17", main: "black", galleries: {}, replace: true }] },
  ])
  assert.ok(h.jobs.some((j) => j.phase === "colours" && j.label === "Saving phone colours 2 of 2…"))
  same([result.perModel, result.pictures, result.failure, result.steps.every((x) => x.done)], [2, 9, null, true])
  await assert.rejects(publishHarness({ shotsOf: (c) => (c === "Glacier" ? [13] : [1]), models: [m18([BLACK, GLACIER])] }).run(), /phone colours share none of the gallery shots/)
})

test("a phone colour call that fails or is stopped leaves the product, and Retry sends only the rest", async () => {
  // a refused call: the product stays, the failure is returned, and a retry sends only the calls not done
  const refused = publishHarness({ models: [m18(), m17()], failPost: (url, body) => (url.endsWith("/colours") && body.variants[0].device === "iphone-17" ? new ApiErrorStub("iPhone 17 has no phone colours. Add them in Mockup sets.", 400) : null) })
  const r = await refused.run()
  assert.equal(refused.posts(/\/custom$/).length, 1)
  same(r.failure, { label: "the phone colours of iPhone 17", message: "iPhone 17 has no phone colours. Add them in Mockup sets.", stopped: false })
  same(r.steps.map((x) => x.done), [true, false])
  const retry = publishHarness()
  assert.equal(await retry.lib.runSteps(r.steps, { stopped: () => false, onStep() {} }), null)
  same(retry.posts(/./).map((e) => e[2].variants[0].device), ["iphone-17"], "only the call that was not saved")
  same(r.steps.map((x) => x.done), [true, true])
  // Stop in this phase: the current model's call finishes, the next is not sent
  const stopped = publishHarness({ models: [m18(), m17()], stopWhen: (log) => log.some((e) => e[1].endsWith("/colours")) })
  const s = await stopped.run()
  assert.equal(stopped.posts(/\/colours$/).length, 1)
  same([s.failure.stopped, s.failure.label, s.steps.map((x) => x.done)], [true, "the phone colours of iPhone 17", [true, false]])
  // no answer or a gateway error: one more try (the call is idempotent)
  let fails = 1
  const flaky = publishHarness({ failPost: (url) => (url.endsWith("/colours") && fails-- > 0 ? new ApiErrorStub("Bad gateway", 502) : null) })
  assert.equal((await flaky.run()).failure, null)
  assert.equal(flaky.posts(/\/colours$/).length, 2)
})

const existingDesign = {
  slug: "bloom", name: "Bloom", kind: "design", collection: null,
  products: [{ id: "prod_1", form: "phone", status: "published", description: "", variants: [
    { id: "variant_a", caseTypeSlug: "signature", deviceSlug: "iphone-18-pro-max" },
    { id: "variant_b", caseTypeSlug: "armor-black", deviceSlug: "iphone-17" },
  ] }],
}
const updating = { mode: "update", name: "", slug: "bloom", description: "", status: "draft", collection: "", newCollection: "", stock: "0" }

test("one model's refused phone colours never hold back the other models; no answer still stops the run", async () => {
  const m16 = () => model("iphone-16", "iPhone 16")
  const devices = (h) => h.posts(/\/colours$/).map((e) => e[2].variants[0].device)
  // the middle model is refused (e.g. its set was edited in another tab): the models after it still save
  const refused = publishHarness({ models: [m18(), m17(), m16()], failPost: (url, body) => (url.endsWith("/colours") && body.variants[0].device === "iphone-17" ? new ApiErrorStub("Silver is not a phone colour of iPhone 17. Choose one from its Mockup set.", 400) : null) })
  const r = await refused.run()
  same(devices(refused), ["iphone-18-pro-max", "iphone-17", "iphone-16"], "a 4xx is not retried and the next model is sent")
  same(r.failure, { label: "the phone colours of iPhone 17", message: "Silver is not a phone colour of iPhone 17. Choose one from its Mockup set.", stopped: false })
  same(r.steps.map((x) => x.done), [true, false, true])
  const retry = publishHarness()
  assert.equal(await retry.lib.runSteps(r.steps, { stopped: () => false, onStep() {} }), null)
  same(devices(retry), ["iphone-17"], "Retry sends only the refused model")
  // the first refusal is the one reported; every refused model stays not done
  const two = publishHarness({ models: [m18(), m17(), m16()], failPost: (url, body) => (url.endsWith("/colours") && body.variants[0].device !== "iphone-17" ? new ApiErrorStub(`No set for ${body.variants[0].device}`, 400) : null) })
  const t = await two.run()
  same([t.failure.label, t.steps.map((x) => x.done)], ["the phone colours of iPhone 18 Pro Max", [false, true, false]])
  // no answer (a server error on both tries, a timeout), a lost session or a design that is gone: every later call
  // would fail too, so the run stops at that model
  for (const error of [new ApiErrorStub("Bad gateway", 502), new Error("The server took too long."), new ApiErrorStub("Sign in again.", 401), new ApiErrorStub("No design found.", 404)]) {
    const h = publishHarness({ models: [m18(), m17(), m16()], failPost: (url, body) => (url.endsWith("/colours") && body.variants[0].device === "iphone-17" ? error : null) })
    const s = await h.run()
    same([s.failure.label, s.steps.map((x) => x.done)], ["the phone colours of iPhone 17", [true, false, false]], error.message)
    assert.ok(!devices(h).includes("iphone-16"), error.message)
  }
  // the ordered Update pictures saves still stop at the first refusal
  const ordered = publishHarness({ checkStatus: 200, checkBody: { design: existingDesign }, models: [m18(), m17()], patch: { details: updating },
    failPost: (url) => (url.endsWith("/manager-variants") ? new ApiErrorStub("Unknown variant", 400) : null) })
  const o = await ordered.run()
  assert.equal(ordered.posts(/\/(pairs|colours)$/).length, 0, "a refused main-picture save sends nothing after it")
  assert.equal(o.failure.stopped, false)
})

test("Update pictures: manager-variants for the models the design has, /pairs for the missing ones, then the colours; never /custom", async () => {
  const h = publishHarness({ checkStatus: 200, checkBody: { design: existingDesign }, models: [m18([BLACK, SILVER]), m17()], patch: { details: updating } })
  const result = await h.run()
  assert.equal(h.posts(/\/custom$/).length, 0)
  assert.equal(h.uploads().every((b) => b.designSlug === "bloom"), true)
  const after = h.log.filter((e) => e[0] === "post" && !e[1].endsWith("/upload"))
  same(after.map((e) => e[1]), ["/admin/products/prod_1/manager-variants", "/admin/designs/bloom/pairs", "/admin/designs/bloom/colours", "/admin/designs/bloom/colours"])
  same(after[0][2], { variants: [{ id: "variant_a", images: ["u1", "u2", "u3"] }] }, "only images: the IDs, prices and stock stay")
  same(after[1][2], { pairs: { signature: { "iphone-17": ["u7", "u8", "u9"] } }, blankStock: 0 }, "the missing model, never resetting stock")
  same(after[2][2].variants, [{ caseType: "signature", device: "iphone-18-pro-max", main: "black", galleries: { silver: ["u4", "u5", "u6"] }, replace: true }])
  assert.equal(after[3][2].variants[0].replace, true, "older colour pictures are cleared")
  assert.ok(h.jobs.some((j) => j.phase === "saving"))
  same([result.slug, result.failure, result.steps.length], ["bloom", null, 4])
})

test("Update pictures: a save that fails is reported, and Retry sends only the steps not confirmed, uploading nothing again", async () => {
  const h = publishHarness({ checkStatus: 200, checkBody: { design: existingDesign }, models: [m18(), m17()], patch: { details: updating },
    failPost: (url) => (url.endsWith("/pairs") ? new ApiErrorStub("Unknown device", 400) : null) })
  const r = await h.run()
  same(r.failure, { label: "1 new model", message: "Unknown device", stopped: false })
  same(r.steps.map((x) => [x.path, x.done]), [["/admin/products/prod_1/manager-variants", true], ["/admin/designs/bloom/pairs", false], ["/admin/designs/bloom/colours", false], ["/admin/designs/bloom/colours", false]])
  const retry = publishHarness()
  assert.equal(await retry.lib.runSteps(r.steps, { stopped: () => false, onStep() {} }), null)
  same(retry.log.map((e) => e[1]), ["/admin/designs/bloom/pairs", "/admin/designs/bloom/colours", "/admin/designs/bloom/colours"])
})

test("Update pictures: a design that is gone or not a Studio design changes nothing; batches stay at 20 models", async () => {
  const gone = publishHarness({ checkStatus: 404, patch: { details: updating } })
  await assert.rejects(gone.run(), /No design uses the URL "bloom" any more/)
  assert.equal(gone.log.filter((e) => e[0] === "post").length, 0)
  const regular = publishHarness({ checkStatus: 200, checkBody: { design: { ...existingDesign, kind: "regular" } }, patch: { details: updating } })
  await assert.rejects(regular.run(), /can't update/)
  assert.equal(regular.webps.length, 0)
  // 45 models the design has and 25 it does not: manager-variants and /pairs in batches of at most 20
  const have = Array.from({ length: 45 }, (_, i) => `have-${i}`), lack = Array.from({ length: 25 }, (_, i) => `lack-${i}`)
  const d = { ...existingDesign, products: [{ ...existingDesign.products[0], variants: have.map((device, i) => ({ id: `variant_${i}`, caseTypeSlug: "signature", deviceSlug: device })) }] }
  const models = [...have, ...lack].map((device) => model(device, device, [BLACK]))
  const urls = Object.fromEntries(models.map((m) => [m.set.device, { black: ["https://img/x.webp"] }]))
  const steps = gone.lib.updateSteps(d, "signature", models, urls)
  const sizes = (re, key) => steps.filter((x) => re.test(x.path)).map((x) => (key === "pairs" ? Object.keys(x.body.pairs.signature).length : x.body.variants.length))
  same(sizes(/manager-variants$/), [20, 20, 5])
  same(sizes(/\/pairs$/, "pairs"), [20, 5])
  assert.equal(sizes(/\/colours$/).length, 70, "one colours call per model")
  assert.ok(Math.max(...steps.map((x) => JSON.stringify(x.body).length)) < 100_000)
})

test("ZIPs: one model in one colour is flat, several colours or models get a <device>_<colour>/ folder each", () => {
  const { zipItems } = publishHarness().lib
  const meta = { sizes: [600], shots: [{ n: 1, name: "01 Front - design" }, { n: 5, name: "05 Camera close-up" }] }
  const one = [{ set: P18, model: "iPhone 18 Pro Max", colours: [{ name: "Black", meta }] }]
  same(zipItems(one, [1], true).map((x) => x.entry(2400)), ["01-front-design_2400.png", "05-camera-close-up_2400.png"])
  same(zipItems(one, [1], false).map((x) => x.entry(2400)), ["iphone-18-pro-max_black/01-front-design_2400.png", "iphone-18-pro-max_black/05-camera-close-up_2400.png"], "Download all keeps folders")
  const two = [{ set: P18, model: "iPhone 18 Pro Max", colours: [{ name: "Black", meta }, { name: "Wine Red", meta, full: false }] }]
  const items = zipItems(two, [5], true)
  same(items.map((x) => [x.colour, x.shot, x.entry(1200)]), [
    ["Black", 5, "iphone-18-pro-max_black/05-camera-close-up_1200.png"], ["Black", 1, "iphone-18-pro-max_black/01-front-design_1200.png"],
    ["Wine Red", 5, "iphone-18-pro-max_wine-red/05-camera-close-up_1200.png"], ["Wine Red", 1, "iphone-18-pro-max_wine-red/01-front-design_1200.png"],
  ])
  assert.equal(items[2].full, false)
})

test("four steps: the design is placed in step 1, and stock is checked only when Details asks for it", () => {
  assert.equal(JSON.stringify(wiz.STEPS.map((x) => x.id)), JSON.stringify(["design", "models", "details", "review"]))
  let s = wiz.initialState()
  s = wiz.reducer(s, { type: "details", patch: { name: "Bloom", slug: "bloom", slugTouched: true, stock: "x" } })
  assert.equal(wiz.fieldErrors(s, "free").stock, "Enter a whole number, 0 or more.")
  assert.equal(wiz.fieldErrors(s, "free", false).stock, undefined, "every blank exists: no stock field, nothing to check")
  const ctx = { chosen: [], metas: {}, slugState: "free", deviceName: (x) => x }
  assert.match(wiz.stepErrors(s, ctx).details, /whole number/)
  assert.equal(wiz.stepErrors(s, { ...ctx, stockShown: false }).details, undefined)
})
