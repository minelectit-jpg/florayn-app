// Puts a design on a pre-rendered Blender shot, no Blender needed (MOCKUP_STUDIO.md).
// Validated against Blender renders of the same designs (iPhone 18 Pro Max Black, 2400 px, 2026-10-17: shots 1, 3, 5, 6,
// 8, 11 and 12, a 2 mm test grid and a marble): print-area mean difference 3.73 of 255 on average (3.97 with the
// 2026-10-16 settings), 3.10 at the shop size, 1200 px made from 2400 (3.37 before).
//
// Layers per shot (8-bit PNGs, decoded to byte arrays):
//   static  RGB  B render (print surface black), premultiplied linear, enc(v) = sqrt(v / (1 + v))
//   light   RGB  W - B (light reaching the print), same encoding
//   uv      RGB  u high, u low, v high (16-bit artwork coordinate, 0..1 = the print template)
//   aux     RGB  v low, alpha, print coverage
//   blur    1 ch spread of the artwork seen in the pixel (pixel filter and depth of field), mm: (2^(b/24) - 1) / 64,
//           with the pack's float32 rounding on top, which composite() takes off (BLUR_NOISE)
// Shot (linear) = static + design(uv) * light, then Khronos PBR Neutral and sRGB, like the .blend.

export type ShotMeta = { template_mm: [number, number]; ink_saturation: number }
export type ShotLayers = { w: number; h: number; static: Uint8Array; light: Uint8Array; uv: Uint8Array; aux: Uint8Array; blur: Uint8Array }
type Level = { w: number; h: number; data: Uint8Array }
export type PreparedDesign = { levels: Level[]; mean: [number, number, number] }

const DEC = new Float32Array(256)
for (let b = 0; b < 256; b++) {
  const t = Math.min((b / 255) ** 2, 0.9961)
  DEC[b] = t / (1 - t)
}
const S2L = new Float32Array(256)
for (let b = 0; b < 256; b++) {
  const c = b / 255
  S2L[b] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const L2S_N = 4096
const L2S = new Uint8Array(L2S_N + 1)
for (let i = 0; i <= L2S_N; i++) {
  const x = i / L2S_N
  L2S[i] = Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255)
}
const toByte = (x: number) => L2S[Math.round(Math.min(Math.max(x, 0), 1) * L2S_N)]

/** Blender's Hue/Saturation/Value node on linear colour (hue unchanged, value 1). */
function saturate(r: number, g: number, b: number, sat: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (max <= 0 || d <= 0) return [r, g, b]
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  if (h < 0) h += 1
  const s = Math.min((d / max) * sat, 1), v = max
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

/** Khronos PBR Neutral tone mapping, in place. */
function pbrNeutral(c: number[]) {
  const start = 0.8 - 0.04, desat = 0.15
  const x = Math.min(c[0], c[1], c[2])
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04
  c[0] -= off; c[1] -= off; c[2] -= off
  const peak = Math.max(c[0], c[1], c[2])
  if (peak < start) return
  const d = 1 - start
  const np = 1 - (d * d) / (peak + d - start)
  const k = np / peak
  c[0] *= k; c[1] *= k; c[2] *= k
  const g = 1 - 1 / (desat * (peak - np) + 1)
  c[0] += (np - c[0]) * g; c[1] += (np - c[1]) * g; c[2] += (np - c[2]) * g
}

/** Ink saturation as in the Blender material, then a mip chain. pixels: sRGB bytes, 3 or 4 channels. */
export function prepareDesign(pixels: ArrayLike<number>, w: number, h: number, channels: number, saturation = 1.06): PreparedDesign {
  const base = new Uint8Array(w * h * 3)
  let sr = 0, sg = 0, sb = 0
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    const [r, g, b] = saturate(S2L[pixels[j]], S2L[pixels[j + 1]], S2L[pixels[j + 2]], saturation)
    base[i * 3] = toByte(r); base[i * 3 + 1] = toByte(g); base[i * 3 + 2] = toByte(b)
    sr += r; sg += g; sb += b
  }
  const levels: Level[] = [{ w, h, data: base }]
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const p = levels[levels.length - 1]
    const nw = Math.max(1, p.w >> 1), nh = Math.max(1, p.h >> 1)
    const d = new Uint8Array(nw * nh * 3)
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(y * 2, p.h - 1), y1 = Math.min(y * 2 + 1, p.h - 1)
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(x * 2, p.w - 1), x1 = Math.min(x * 2 + 1, p.w - 1)
        for (let c = 0; c < 3; c++) {
          const v = S2L[p.data[(y0 * p.w + x0) * 3 + c]] + S2L[p.data[(y0 * p.w + x1) * 3 + c]] +
            S2L[p.data[(y1 * p.w + x0) * 3 + c]] + S2L[p.data[(y1 * p.w + x1) * 3 + c]]
          d[(y * nw + x) * 3 + c] = toByte(v / 4)
        }
      }
    }
    levels.push({ w: nw, h: nh, data: d })
  }
  const n = w * h
  return { levels, mean: [sr / n, sg / n, sb / n] }
}

// Bilinear sample of one mip level in Blender image coordinates (v = 0 at the bottom), EXTEND at the edges.
function bilinear(lv: Level, u: number, v: number, out: number[], k: number) {
  const x = Math.min(Math.max(u * lv.w - 0.5, 0), lv.w - 1)
  const y = Math.min(Math.max((1 - v) * lv.h - 0.5, 0), lv.h - 1)
  const x0 = x | 0, y0 = y | 0, x1 = Math.min(x0 + 1, lv.w - 1), y1 = Math.min(y0 + 1, lv.h - 1)
  const fx = x - x0, fy = y - y0, d = lv.data
  const a = (y0 * lv.w + x0) * 3, b = (y0 * lv.w + x1) * 3, c = (y1 * lv.w + x0) * 3, e = (y1 * lv.w + x1) * 3
  for (let ch = 0; ch < 3; ch++) {
    const top = S2L[d[a + ch]] + (S2L[d[b + ch]] - S2L[d[a + ch]]) * fx
    const bot = S2L[d[c + ch]] + (S2L[d[e + ch]] - S2L[d[c + ch]]) * fx
    out[ch] = out[ch] * (1 - k) + (top + (bot - top) * fy) * k
  }
}

/** How the depth-of-field spread and the pixel footprint pick the mip level. */
export type Sharpness = { blurScale: number; lodBias: number }
/**
 * Best match to Blender with the corrected (no longer transposed) blur layers: quality study 2026-10-17, re-checked on
 * held-out shots and two more test designs (MOCKUP_STUDIO.md). Used with BLUR_NOISE and with denoiseBlur at load. In
 * focus the level is log2(footprint) - 0.5; out of focus the level is 2 x 2^-0.5 = 1.41 x the spread wide, which matches
 * the lens blur. The 2026-10-16 value, blurScale 1.5 (1.06 x), was tuned on blur maps that were still transposed and
 * left the depth-of-field shots 05 and 06 too sharp.
 */
export const SHARPNESS: Sharpness = { blurScale: 2, lodBias: -0.5 }
/**
 * Float32 rounding in the blur layer, per template mm of artwork coordinate. The pack computes the spread as
 * E[uv^2] - E[uv]^2 from float32 passes, which is off by about sqrt(2 x 2^-24) x |uv|: 0.03-0.08 mm, as large as the
 * real in-focus spread (the pixel filter's, about 0.6 x the footprint, which the footprint term already covers). Seen
 * in the corrected layers: at a constant footprint the in-focus values spread wider as |uv| grows, and on the macro
 * shot 12, whose real in-focus spread is far smaller, 27% of the print pixels read 0 (a negative variance, clamped).
 * composite() takes BLUR_NOISE x |uv in mm| off in quadrature, so in-focus pixels keep the footprint's level and real
 * depth of field (0.1-0.7 mm) stays. 4e-4 fitted best (3e-4..6e-4 within 1%).
 */
export const BLUR_NOISE = 4e-4

/**
 * 5x5 median of the blur layer over print pixels; run once per layer load (loadLayers in layers.ts). The rounding is
 * not a steady offset: between neighbouring pixels it ranges from 0 to well above BLUR_NOISE's floor, so the mip level
 * would still jump from pixel to pixel (a sparkly halo at hard edges); the median evens it out. Measured on the corrected
 * layers with the floor (2026-10-17): print-area Laplacian correlation 0.65 -> 0.74, mean difference 3.95 -> 3.73. The
 * older figure (2026-10-16, shot 12 0.64 -> 0.74) was measured on blur maps that were still transposed.
 * For each pixel with coverage > 0: the lower median of the window's pixels with coverage >= 128 (kept when there are
 * none). Pixels outside the print keep their value. A sliding histogram per row gives the same bytes as sorting each
 * 5x5 window (tests/mockup-studio.test.cjs keeps that version as the reference) about 4x faster: 2400 px 0.15-0.23 s.
 */
export function denoiseBlur(blur: Uint8Array, aux: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(blur) // a copy (Buffer.slice would share memory)
  const hist = new Int32Array(256)
  for (let y = 0; y < h; y++) {
    let any = false // rows without a print pixel need nothing
    for (let k = y * w * 3 + 2, end = (y + 1) * w * 3; k < end; k += 3) if (aux[k] !== 0) { any = true; break }
    if (!any) continue
    const y0 = Math.max(0, y - 2), y1 = Math.min(h - 1, y + 2)
    hist.fill(0)
    let n = 0, m = 0, below = 0 // samples in the window, median candidate, samples below it
    for (let x = -2; x < w; x++) {
      const add = x + 2, drop = x - 3
      if (add < w) {
        for (let yy = y0; yy <= y1; yy++) {
          const k = yy * w + add
          if (aux[k * 3 + 2] < 128) continue
          const v = blur[k]
          hist[v]++; n++
          if (v < m) below++
        }
      }
      if (drop >= 0) {
        for (let yy = y0; yy <= y1; yy++) {
          const k = yy * w + drop
          if (aux[k * 3 + 2] < 128) continue
          const v = blur[k]
          hist[v]--; n--
          if (v < m) below--
        }
      }
      if (x < 0) continue
      const i = y * w + x
      if (aux[i * 3 + 2] === 0 || n === 0) continue
      const t = (n - 1) >> 1 // the lower median is the t-th smallest
      while (below > t) { m--; below -= hist[m] }
      while (below + hist[m] <= t) { below += hist[m]; m++ }
      out[i] = m
    }
  }
  return out
}

/** Returns RGBA bytes, straight alpha, sRGB (like the Blender PNG). Expects the blur layer already through denoiseBlur. */
export function composite(layers: ShotLayers, meta: ShotMeta, design: PreparedDesign, { blurScale, lodBias }: Sharpness = SHARPNESS): Uint8ClampedArray {
  const { w, h } = layers
  const n = w * h
  const U = new Float32Array(n), V = new Float32Array(n), M = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 3
    M[i] = layers.aux[j + 2]
    U[i] = (layers.uv[j] * 256 + layers.uv[j + 1]) / 65535
    V[i] = (layers.uv[j + 2] * 256 + layers.aux[j]) / 65535
  }
  const L0 = design.levels[0]
  const pxPerMm = L0.w / meta.template_mm[0]
  const tw = L0.w, th = L0.h
  const [mmX, mmY] = meta.template_mm
  const noise2 = BLUR_NOISE * BLUR_NOISE
  const maxLod = design.levels.length - 1
  const out = new Uint8ClampedArray(n * 4)
  const col = [0, 0, 0], c = [0, 0, 0]
  // distance in design pixels to a neighbour, or Infinity when it is not print (seams, holes)
  const dist = (i: number, k: number) => {
    if (k < 0 || k >= n || M[k] < 128) return Infinity
    return Math.hypot((U[k] - U[i]) * tw, (V[k] - V[i]) * th)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, j = i * 3, o = i * 4
      const a = layers.aux[j + 1] / 255
      if (a <= 0) continue
      if (M[i] > 0) {
        // the pixel's footprint on the artwork: the smaller step to a neighbour per axis (robust at seams)
        let fx = Math.min(x > 0 ? dist(i, i - 1) : Infinity, x < w - 1 ? dist(i, i + 1) : Infinity)
        let fy = Math.min(y > 0 ? dist(i, i - w) : Infinity, y < h - 1 ? dist(i, i + w) : Infinity)
        if (!isFinite(fx)) fx = isFinite(fy) ? fy : 1
        if (!isFinite(fy)) fy = fx
        // the spread without the pack's float32 rounding (BLUR_NOISE)
        const s = (2 ** (layers.blur[i] / 24) - 1) / 64, mu = U[i] * mmX, mv = V[i] * mmY
        const s2 = s * s - noise2 * (mu * mu + mv * mv)
        const sigmaMm = s2 > 0 ? Math.sqrt(s2) : 0
        const foot = Math.max(1, fx, fy, sigmaMm * pxPerMm * blurScale)
        // a negative bias would ask for a level sharper than the design itself: clamp to 0..maxLod
        const lod = Math.min(Math.max(Math.log2(foot) + lodBias, 0), maxLod)
        const l0 = Math.floor(lod), f = lod - l0
        col[0] = col[1] = col[2] = 0
        bilinear(design.levels[l0], U[i], V[i], col, 1)
        if (f > 0 && l0 < maxLod) bilinear(design.levels[l0 + 1], U[i], V[i], col, f)
      } else {
        col[0] = design.mean[0]; col[1] = design.mean[1]; col[2] = design.mean[2]
      }
      for (let ch = 0; ch < 3; ch++) c[ch] = (DEC[layers.static[j + ch]] + col[ch] * DEC[layers.light[j + ch]]) / a
      pbrNeutral(c)
      out[o] = toByte(c[0]); out[o + 1] = toByte(c[1]); out[o + 2] = toByte(c[2])
      out[o + 3] = Math.round(a * 255)
    }
  }
  return out
}
