# Mockup Studio

Florayn Console > Mockup Studio (CONSOLE.md, `/console#/mockup-studio`) turns one flat design into Blender-quality mockups for
every chosen phone model, then creates an ordinary Product Manager design
product from them. No Blender runs on the server or in the shop: Blender
renders each shot once per model ("layers"), and the browser puts any design on
those layers in a fraction of a second.

## How a mockup is made

For every shot, Blender renders the same frame twice: the printed shell's base
colour forced to white (W) and to black (B). Everything else is identical, so
for a design colour `c` (linear) the shot is

    B + c * (W - B)

then the file's view transform (Khronos PBR Neutral) and sRGB. W also writes
the artwork coordinate the material samples (`wrap uv`), its square (for the
depth-of-field blur) and the print coverage as AOVs. This is exact for the
direct light and one bounce. The case material is a dielectric with a coat, so
its reflections do not depend on the design.

Checked against the Blender finals of the iPhone 18 Pro Max (all 13 shots,
2400 px, the original marble artwork): the print area differs by 1.3-3.5 out
of 255 on average, about the noise between two Blender renders.

### Sharpness (quality study 2026-10-16)

The `blur` layer is the spread of the artwork seen in each pixel (depth of
field). In focus its true value is below float32 resolution, so the packed layer
is mostly noise there; multiplied up, that noise picked a random mip level per
pixel and drew a fuzzy, sparkly halo round every hard edge. Two fixes, in
`console/src/mockup/compositor.ts` and `web\compositor.mjs` alike:

- `SHARPNESS = { blurScale: 1.5, lodBias: -0.5 }` (was 2.5 and 0). The mip level
  is `log2(max(1, footprint, sigma * px/mm * blurScale)) + lodBias`, clamped to
  0..last level, which matches Blender's pixel filter (about 0.21 px) instead
  of blurring about 0.5 px.
- `denoiseBlur`: a 5 x 5 median of the blur layer over print pixels, applied
  once when a shot's layers load (`loadLayers`; `validate.mjs` and `worker.mjs`
  do the same). It gives the same bytes as sorting every window, about 4x faster.

`validate.mjs`, iPhone 18 Pro Max Black, 2400 px: the print area's mean
difference went from 1.98 to 1.66 of 255 on average, lower on 12 of 13 shots
(shot 06 flat); shot 12's p99 went from 13 to 6. On `_quality\haze_test_design.png`
(mean / p95 over the print) shot 1 went from 5.82 / 26 to 4.14 / 20, shot 3 from
5.64 / 23 to 4.14 / 17 and shot 12 from 7.09 / 36 to 3.25 / 15; the halo is
gone. The haze left on shot 3 is real Blender lighting (the clear coat reflects
the studio light): fix it in Blender and re-render shot 3 if it matters.

## The layers

The Blender side lives on the owner's PC in
`Documents\Blender 3D Model\_pipeline\mockup\`:

- `mockup_layers.py` renders W and B for every timeline marker of a part file
  and packs them with `mockup_pack.py`.
- `run_layers.ps1 -Model "<model>" -Colours "A,B"` runs every colour on the GPU,
  waits for other renders and skips shots already done (a power cut loses at
  most the shot in progress).
- `web\compositor.mjs` is the reference compositor, `web\validate.mjs` compares
  composites with the Blender finals, and `serve.mjs` serves a local test page.

Output: `D:\Florayn mockup layers\<model>\<colour>\meta.json` and
`<colour>\<size>\<NN> <layer>.png` for 2400, 1200 and 600 px. Five 8-bit PNGs
per shot (`apps/backend/console/src/mockup/compositor.ts` documents the
encoding). The pack box-averages coverage-weighted values, so every size is
exact, not a resized image.

## Console screens

- **Mockup sets**: the models that have mockups, each on/off, its default
  phone colour, and "Check" (the browser can read every colour). Nothing is
  uploaded here (the owner: designs are the only upload).
- **New product**: a five-step wizard with a sticky stepper and a sticky
  Back / Continue footer:
  1. **Design**: one flat image (PNG, JPG or WebP, up to 60 MB and 12,000 px;
     also drop or paste). The stage shows the real case at once, with a
     placeholder design until the upload.
  2. **Models**: one, several or all, each with the phone colour for its
     pictures (the colour only changes the pictures, not what is sold).
  3. **Placement**: drag on the phone on any angle (the shot's `uv` layer says
     which artwork point is under the pointer), scroll or pinch to zoom, or
     use the sliders and the flat print preview. One position for every model;
     the design always covers the whole print.
  4. **Details**: title (= design name), URL (checked as you type), collection
     (existing or new), starting stock, description.
  5. **Review & publish**: every picture of every model, full-size view,
     downloads, then Create draft / Publish product.

  New product stays mounted while Mockup sets or Settings is open, so nothing
  is lost by switching tabs; leaving the page or reloading asks first.

  **Downloads are lossless and made in the browser**: a single picture or a
  ZIP per model or for all models, PNG at 2400 x 2400 px on white or
  transparent. Where a colour's 2400 px layers are not uploaded, the worker
  falls back to 1200 px, says so, and names the file `_1200` (once a HEAD check
  has found them missing, the page asks for 1200 px straight away). The ZIP is
  written by `console/src/mockup/zip.ts` (stored entries, no dependency). On
  phones the full-size view's Share button hands over a PNG made as soon as the
  picture is shown, because the share sheet only opens within the tap itself.

  **Compressed only for the shop**: publishing composites the gallery shots,
  flattens them on white and encodes WebP at the Settings quality (JPEG where
  the browser cannot encode WebP, i.e. Safari, uploaded as `{n}.jpg`), uploads
  each through `/admin/designs/upload` while the next one is being made, and
  calls `/admin/designs/custom` with `{ <case type>: { <device>: [urls] } }`,
  the same path as Product Manager > Create product. Prices, shared blank
  stock, URLs and drafts therefore follow PRODUCT_MANAGER.md unchanged. With
  "Sharper shop images" on (and an image size of 1200 or less, not on a phone)
  each shop image is made from the 2400 px renders and shrunk: mean
  difference 0.76 vs 0.91 against Blender, about 4x slower to publish.

  Quality levels (desktop timings):

  | Use | Worker | Layers | Design width | Output |
  |---|---|---|---|---|
  | Stage Live (while dragging, wheeling or sliding) | quick | 600 | 1024 | bitmap at the screen's pixels, at most 600 |
  | Stage Sharp (150 ms after a placement change; at once for angle, model or colour) | detail | 1200 | 2048 | bitmap at the screen's pixels (~0.25 s) |
  | Stage Full (screens over 1300 device px, mouse, not a phone; 1.2 s after Sharp) | detail | 2400 | 4096 | bitmap at the screen's pixels (~1 s) |
  | Filmstrip, model cards, review tiles | quick | 600 | 1024 | bitmap at the box's pixels, at most 600 |
  | Full-size view, single PNG | detail | 2400 (1200 fallback) | 4096 | lossless (~1-1.5 s) |
  | ZIP | export | 2400 (1200 fallback) | 4096 | PNG (~1 s each) |
  | Shop images | export | 2400 shrunk to the image size (Sharper on), else the image size | 4096 / 2048 / 1024 | WebP at the Settings quality |

  Phones and small devices (`isLowMemory`) use 3072 instead of 4096 (iOS caps
  a canvas at 16.7 MP), smaller caches, no Full pass and no separate export
  worker; a design is also shrunk to at most 16 MP there, and the 2400 px
  layers decode one file at a time. Every design width is capped at the
  source's own resolution. The stage canvas is drawn at exactly
  `css width x devicePixelRatio`, so nothing on screen is stretched or
  compressed. If a worker dies (memory), the pictures it was making fail with
  "The browser ran out of memory making the pictures..." and a fresh worker
  takes over; pictures asked for meanwhile wait for the design and finish
  there. A worker's layer downloads do not hold it: another picture renders
  while they load, and a full-size render that has been replaced stops before
  its composite. A design that fails to open never stays on the workers: the
  page sends the current one (or the placeholder) back.
- **Settings**: the case type the mockups show (new products are sold in it),
  the gallery shots in order, image size (shop images only; the shop uses
  1200 px), WebP quality (default 92: 0.88-0.98 of the print detail vs
  0.62-0.84 at 85, about 47 KB per 1200 px image vs 28 KB; saved settings keep
  their quality, "Use 92" sets it) and "Sharper shop images" (`supersample`,
  default on).

Settings live in the store metadata under `florayn_mockups`
(`src/lib/mockup-settings.ts`, `GET/POST /admin/mockups`). No migration.

Browser code: `apps/backend/console/src/mockup/` (`compositor.ts`, `layers.ts`,
`worker.ts` + `client.ts`, which composite in Web Workers, and `zip.ts`) and
`console/src/pages/mockup-studio/`; the New product wizard is
`new-product.tsx` plus `wizard/` (`state.ts`: reducer, validation, placement
maths and file names, unit-tested in `tests/mockup-studio.test.cjs`;
`engine.ts`: render scheduling; `preview.tsx`, `steps.tsx`, `review.tsx`,
`lightbox.tsx`; `export.ts`: ZIP and publish, whose server path (URL check
first, upload bodies, the `/custom` body, Stop) is unit-tested in the same file).

## Adding a model's mockups

1. Render and pack the layers with `run_layers.ps1` (see above), and check them
   with `validate.mjs`.
2. Upload the 600, 1200 and 2400 px sizes and `meta.json` with
   `node upload-layers.mjs "<D:Florayn mockup layersModel>" <device-slug> <cloudflare token file> 600,1200,2400`
   (Cloudflare R2 API, bucket `florayn-images`). `meta.json` lists 2400 even when
   it is not uploaded; the studio then makes downloads at 1200 px and says so
   (pass an existing version as the fifth argument to add 2400 later). It writes
   `mockups/<device>/<version>/<colour>/...`, a new version folder every time
   because the files are served as immutable, and prints the `base_url` on
   `https://img.florayn.com`.
3. The model must exist (Console > Models; add it hidden until it has products).
4. Save the set with `POST /admin/mockups` (signed in): device, base_url,
   colours, default_colour, enabled.

iPhone 18 Pro Max (2026-10-15): `https://img.florayn.com/mockups/iphone-18-pro-max/v20261015T1657Z`.

## The R2 CORS rule

The browser must read the layer pixels, so the bucket `florayn-images` has
this CORS rule (set 2026-10-15 through the Cloudflare API; the same in the
dashboard under R2 > bucket > Settings > CORS policy). Cloudflare caches a copy
per site (`Vary: Origin`), so every listed site gets its own header:

```json
[
  {
    "AllowedOrigins": ["https://api.new.florayn.com", "https://new.florayn.com", "https://api.florayn.com", "https://florayn.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

Without it, previews fail with "The browser could not read the layer files".

## Rules for later changes

1. Never change how products are created here. Mockup Studio only makes images
   and calls the Product Manager endpoints; everything in PRODUCT_MANAGER.md
   still applies.
2. Keep the compositor in step with `web\compositor.mjs` and the pack encoding.
   After any change, run `validate.mjs` against the Blender finals.
3. A new layer upload gets a new version folder. Never overwrite layer files in
   place: browsers and Cloudflare keep them for a year.
4. The 3D case in the renders is one case type. Do not attach these images to
   other case types.
