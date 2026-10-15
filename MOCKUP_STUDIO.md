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

- **Mockup sets**: choose a model and its layer folder. The browser uploads the
  smallest size (live previews) and the product image size through
  `/admin/r2/upload` to `mockups/<device>/<version>/...` (a new version folder
  every time, because R2 serves them as immutable), then saves the set.
  "Check" confirms the browser can read every colour.
- **New product**: design image, models (or all) with the phone colour for the
  pictures, placement (zoom and move, live), name/URL, collection (existing or
  new), starting stock, a preview of every model, then Create draft / Publish.
  Publishing composites the gallery shots at the image size, uploads them as
  WebP on white through `/admin/designs/upload`, and calls
  `/admin/designs/custom` with `{ <case type>: { <device>: [urls] } }`, the same
  path as Product Manager > Create product. Prices, shared blank stock, URLs
  and drafts therefore follow PRODUCT_MANAGER.md unchanged.
- **Settings**: the case type the mockups show (new products are sold in it),
  the gallery shots in order, image size (the shop uses 1200 px) and WebP
  quality.

Settings live in the store metadata under `florayn_mockups`
(`src/lib/mockup-settings.ts`, `GET/POST /admin/mockups`). No migration.

Browser code: `apps/backend/console/src/mockup/` (`compositor.ts`, `layers.ts`,
and `worker.ts` + `client.ts`, which composite in Web Workers) and
`console/src/pages/mockup-studio/`.

## The R2 CORS rule (required once)

The browser must read the layer pixels, so the R2 bucket needs a CORS rule.
Cloudflare dashboard > R2 > the public bucket > Settings > CORS policy:

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
