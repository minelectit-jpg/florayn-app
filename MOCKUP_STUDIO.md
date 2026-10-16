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

### Sharpness (quality study 2026-10-17)

The `blur` layer is the spread of the artwork seen in each pixel (the pixel
filter's and the depth of field's), in template mm. The mip level is
`log2(max(1, footprint, sigma * px/mm * blurScale)) + lodBias`, clamped to
0..last level. In `console/src/mockup/compositor.ts` and `web\compositor.mjs`
alike (same bytes), the chosen setting is blurScale 2, lodBias -0.5, the
rounding floor and the median:

- `SHARPNESS = { blurScale: 2, lodBias: -0.5 }`. The 2026-10-16 setting (1.5
  and -0.5) was tuned on blur maps that were still transposed; on the
  corrected maps it left the depth-of-field shots 05 and 06 too sharp. In focus
  the level is `log2(footprint) - 0.5` as before; out of focus the level is
  1.41 x the spread wide (was 1.06), the box filter whose spread matches the
  lens blur.
- `BLUR_NOISE = 4e-4`: the pack computes the spread as `E[uv^2] - E[uv]^2` from
  float32 passes, which is off by about `sqrt(2 x 2^-24) x |uv|`: 0.03-0.08 mm,
  as large as the real in-focus spread (about 0.6 x the footprint, which the
  footprint term already covers). The corrected layers show it: at a constant
  footprint the in-focus values spread wider as `|uv|` grows, and on the macro
  shot 12, 27% of the print pixels read 0 (a negative variance, clamped). The
  compositor takes `BLUR_NOISE x |uv in mm|` off in quadrature; real depth of
  field (0.1-0.7 mm) stays.
- `denoiseBlur`: a 5 x 5 median of the blur layer over print pixels, applied
  once when a shot's layers load (`loadLayers`; `validate.mjs` and `worker.mjs`
  do the same). The rounding is not a steady offset (from 0 to well above the
  floor between neighbouring pixels), so even with the floor the mip level
  would jump from pixel to pixel; with the median the mean difference is 3.73
  instead of 3.95 and the print-area Laplacian correlation 0.74 instead of
  0.65. (The older figure, shot 12 0.64 -> 0.74 on 2026-10-16, was measured on
  the transposed maps.) It gives the same bytes as sorting every window, about
  4x faster.

Measured against Blender renders of `_quality\haze_test_design.png` (2 mm grid,
labels) and a marble on shots 01, 03, 05, 06, 08, 11 and 12 (iPhone 18 Pro Max
Black part file, new wall mapping, 2400 px, 128 spp; scripts and results in
`D:\Florayn mockup layers\_quality\final\tune\`). Print area, mean / p95 of the
largest channel difference (of 255), averaged over the 14 pictures:

| | 2400 px | shop, 1200 px from 2400 |
|---|---|---|
| 2026-10-16 (1.5, -0.5) | 3.97 / 14.4 | 3.37 / 10.5 |
| now (2, -0.5, floor, median) | 3.73 / 13.4 | 3.10 / 9.4 |

Shot 05 (depth of field) went from 11.6 to 9.9 on the grid, shot 12 (macro)
from 4.25 to 3.39 with the sparkly halo round its grid lines gone; the in-focus
shots are unchanged. Without the floor no single setting fits both: depth of
field wants the larger blurScale, which then turns shot 12's rounding into blur
(2, -0.5 alone: shot 12 5.9). Re-checked on held-out shots (02, 04, 07, 09, 10,
13) and two more test designs (a zone plate, and gratings, checkers and text;
`final\verify\`, `final\refute\`): at 2400 px no other setting was more than
0.5% closer, and leaving out the floor or the median was 4-5% further off.
Still left: for the shop images made from 2400 px a sharper lodBias (-0.75 to
-1) measured 4-8% closer; the far out-of-focus areas of shot 05 are a little
crisper than Blender's round lens blur (a box-filtered mip keeps thin lines
visible), and on shot 12 Blender's cubic texture filter is a bit softer than
bilinear. The haze on shot 3 is real Blender lighting (the clear coat reflects
the studio light).

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

- **Mockup sets**: the models that have mockups, each on/off, its "Default
  phone colour (shop and main picture)", its phone colours as chips (a colour
  picker plus the hex, a "suggested" tag while the dot is the console's SWATCH
  suggestion, and Remove, which asks first when `colour_usage` says designs'
  pictures use that colour; the default colour and a model's last colour
  cannot be removed), and "Check" (the browser can read every colour). The
  colours are the shop's phone colour palette (PHONE_COLOURS.md), so saving
  refreshes the storefront. Nothing is uploaded here (the owner: designs are
  the only upload).
- **New product**: a five-step wizard with a sticky stepper and a sticky
  Back / Continue footer:
  1. **Design**: one flat image (PNG, JPG or WebP, up to 60 MB and 12,000 px;
     also drop or paste). The stage shows the real case at once, with a
     placeholder design until the upload.
  2. **Models**: one, several or all, each with the phone colours to make
     pictures in (the colour only changes the pictures, not what is sold).
     A model's chips are checkboxes: a ring when ticked, a "Main" pip on the
     main colour (the model's default when ticked, else the first ticked in
     palette order; that is what `variant.metadata.images` shows), and the
     last ticked chip is disabled. A newly ticked model gets **every** colour
     (the owner's default); the toolbar's "Phone colours: Main only | All
     colours" re-applies to every chosen model and sets what newly ticked
     models start with. Under it, a live estimate: "39 models · 117 colour
     sets · 1,521 pictures · about 71 MB · about 25 min" (about 47 KB and one
     second per 1200 px shop picture). The stage's chip row on the other steps
     only switches the colour shown, it ticks nothing.
  3. **Placement**: drag on the phone on any angle (the shot's `uv` layer says
     which artwork point is under the pointer), scroll or pinch to zoom, or
     use the sliders and the flat print preview. One position for every model
     and colour; the design always covers the whole print.
  4. **Details**: title (= design name), URL (checked as you type), collection
     (existing or new), starting stock, description. When the URL is taken:
     "This design already exists. Update its pictures instead" (below).
  5. **Review & publish**: every picture of every model, full-size view,
     downloads, then Create draft / Publish product (Update pictures). A
     model with several colours has colour tabs (main first, badged); only the
     shown tab's tiles are made. Every colour of a model uses the gallery
     shots they all have (`sharedShots`); when one colour lacks a shot the
     section says so ("Glacier has 12 of the 13 gallery shots, so every
     colour of this model uses those 12."). Above 500 pictures the publish
     card adds "Publishing takes a while; keep this tab open."

  New product stays mounted while Mockup sets or Settings is open, so nothing
  is lost by switching tabs; leaving the page or reloading asks first.

  **Downloads are lossless and made in the browser**: a single picture or a
  ZIP per model or for all models, PNG at 2400 x 2400 px on white or
  transparent. A ZIP has one `<device>_<colour>/` folder per ticked colour
  (a one-model ZIP in one colour stays flat). Where a colour's 2400 px layers are not uploaded, the worker
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

  **Phone colours** (PHONE_COLOURS.md; `wizard/export.ts` `publishProduct`):
  the plan is every (model, ticked colour, shared shot), main colour first,
  then palette order ("Making iPhone 18 Pro Max · Silver · picture 3 of 13").
  Every upload carries `colourSlug` (the colour's web name, `slugify`), so its
  key is `designs/<design>/<case-type>/<device>/<colour>/<n>.<ext>`. The
  `/custom` body is unchanged: the main colour's URLs only. Then one
  `POST /admin/designs/<slug>/colours` per model, single-colour models included
  (they send only the main marker):
  `{ source: "mockup_studio", variants: [{ caseType, device, main, galleries, replace: true }] }`
  ("Saving phone colours 12 of 39…"). A colours call that fails, or Stop in
  that phase (it stops after the current model), never undoes the product:
  the done screen says "Product created. Phone colour pictures for 3 models
  couldn't be saved" with Retry, which sends only the calls not confirmed
  (the URLs stay in memory), and Make another asks first, because it drops
  that Retry. Until then the product shows its main pictures. A refused call
  (a 4xx for that model) does not stop the next models' calls. Calls with no
  answer or a 5xx are tried once more; every call is idempotent.

  **Update pictures** (re-upload an existing design): on Details, "Update its
  pictures instead" switches the wizard to update mode. Title, collection,
  description, status and stock become the design's own (read from
  `GET /admin/designs/<slug>`, shown read-only, never sent); changing the URL
  goes back to a new product. Publishing makes and uploads the pictures as
  above, then sends only Product Manager endpoints: `manager-variants`
  (`{ variants: [{ id, images }] }`, at most 20 models a call) for the models
  whose `settings.case_type` variant exists, which keeps every ID and rebuilds
  `product.images`, the cover and the cards; `/admin/designs/<slug>/pairs`
  (`blankStock: 0`, at most 20 models a call) for the missing models, which
  reuses the shared blank and never resets stock; then the colours calls with
  `replace: true`. Never `/custom`, never delete and recreate. A failed or
  stopped save shows which one and how many are done; Retry (Continue) sends
  only the ones not confirmed, without uploading again, as long as nothing
  that made the pictures changed (design, placement, models, colours, and
  the case type, gallery shots, image size, quality and supersampling in
  Settings; a dot colour or another model's change in Mockup sets keeps the
  resume); otherwise it publishes again from the start, which is idempotent
  too. One model's refused colours call (a 4xx other than 401 or 404) never
  holds back the other models' calls; no answer, a server error, a lost
  session or a design that is gone stops there. Between the main pictures and the colours call of a model,
  its old colour rows can show the previous pictures for minutes (accepted).

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
first, upload bodies with `colourSlug`, the `/custom` body, one `/colours` call
per model, Stop and Retry, Update pictures' batches, ZIP folders) is unit-tested
in the same file; the multi-colour picks, `mainColourOf`, `sharedShots` and the
estimate too).

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
   colours, default_colour, enabled and optional swatches (colour name ->
   `#rrggbb`). The colours are the shop's phone colour palette, so two names
   may not make the same web name and each must start with a letter
   (PHONE_COLOURS.md); saving refreshes the storefront's catalog.

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
