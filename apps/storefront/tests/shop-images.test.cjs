const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const ts = require("typescript")

// Render the actual grid, cards, image wrapper and Next Image. Only navigation
// and the server-action button are replaced; no network or production data.
const modules = new Map()
function loadSource(relativePath) {
  if (modules.has(relativePath)) return modules.get(relativePath)
  const filename = path.join(__dirname, "../src", relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  modules.set(relativePath, exports)
  vm.runInNewContext(source, {
    exports,
    console,
    require(name) {
      if (name === "next/link") return { __esModule: true, default: ({ prefetch, scroll, ...props }) => React.createElement("a", props) }
      if (name === "@/components/quick-add") return {
        __esModule: true,
        default: ({ variantId }) => React.createElement("button", { "data-variant": variantId }, "Add"),
      }
      if (name.startsWith("@/")) {
        const relative = name.slice(2)
        const extension = fs.existsSync(path.join(__dirname, "../src", `${relative}.tsx`)) ? ".tsx" : ".ts"
        return loadSource(`${relative}${extension}`)
      }
      if (["react", "react/jsx-runtime", "next/image"].includes(name)) return require(name)
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }, { filename })
  return exports
}

const ShopGrid = loadSource("components/shop-grid.tsx").default
const ProductCard = loadSource("components/product-card.tsx").default
const ProductImage = loadSource("components/product-image.tsx").default

function product(index) {
  return {
    id: `p-${index}`, handle: `design-${index}`, title: `Design ${index}`,
    thumbnail: `/audit/design-${index}.webp`,
    variants: [{
      id: `variant-${index}`, options: [{ value: "Phone" }, { value: "Signature" }],
      calculated_price: { calculated_amount: 1400 },
    }],
  }
}

function attributes(tag) {
  return Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name.toLowerCase(), value]))
}

function imageTags(markup) {
  return Array.from(markup.matchAll(/<img\b[^>]*>/g), ([tag]) => attributes(tag))
}

test("shop SSR preloads eight main images and defers remaining requests with responsive noscript fallbacks", () => {
  const markup = renderToStaticMarkup(React.createElement(ShopGrid, {
    products: Array.from({ length: 20 }, (_, index) => product(index)),
    device: "Phone", deviceSlug: "phone", caseType: "Signature", caseTypeSlug: "signature",
    routePath: "/shop/phone/",
  }))
  assert.ok(markup.includes('data-shop-path="/shop/phone/"'), "readiness follows the server route even when a default case type is selected")
  const fallbacks = Array.from(markup.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g), ([, body]) => imageTags(body)[0])
  const images = imageTags(markup.replace(/<noscript>[\s\S]*?<\/noscript>/g, ""))
  assert.equal(images.length, 8, "critical images must remain discoverable before hydration")
  assert.equal(fallbacks.length, 12, "later rows stay accessible without JavaScript")
  for (const [index, image] of [...images, ...fallbacks].entries()) {
    assert.equal(image.fetchpriority, index < 8 ? "high" : "low")
    assert.equal(image.loading, index < 8 ? undefined : "lazy")
    assert.ok(image.srcset.includes(" 384w"), "cards retain responsive optimized images")
    assert.equal(image.alt, `Design ${index}`)
    assert.ok(markup.includes(`data-variant="variant-${index}"`), "image scheduling preserves Quick Add IDs")
  }
  const preloads = Array.from(markup.matchAll(/<link\b[^>]*>/g), ([tag]) => attributes(tag))
    .filter((link) => link.rel === "preload" && link.as === "image")
  assert.equal(preloads.length, 8, "later rows must not create eager image preloads")
  for (const [index, preload] of preloads.entries()) {
    assert.equal(preload.fetchpriority, "high")
    assert.equal(preload.imagesizes, images[index].sizes)
    assert.equal(preload.imagesrcset, images[index].srcset)
  }
})

// Evaluate the emitted sizes at layout boundaries, independently of Next's
// candidate list: the browser should choose for the card, not the monitor.
function slotWidth(sizes, viewport) {
  for (const entry of sizes.split(",")) {
    const clause = entry.trim()
    const media = clause.match(/^\(max-width: (\d+)px\)\s*(.*)$/)
    if (media && viewport > Number(media[1])) continue
    const size = media ? media[2] : clause
    if (/^\d+(\.\d+)?px$/.test(size)) return parseFloat(size)
    const calc = size.match(/^calc\(([\d.]+)vw - ([\d.]+)px\)$/)
    assert.ok(calc, `Unexpected responsive size: ${size}`)
    return viewport * Number(calc[1]) / 100 - Number(calc[2])
  }
  throw new Error("No applicable image size")
}

test("card image sizes match two, three and four columns and stop growing with the container", () => {
  const [image] = imageTags(renderToStaticMarkup(React.createElement(ProductCard, { product: product(0) })))
  for (const viewport of [390, 767, 768, 1023, 1024, 1025, 1280, 1470, 1920, 2431]) {
    const columns = viewport <= 767 ? 2 : viewport <= 1024 ? 3 : 4
    const padding = viewport <= 767 ? 30 : 60
    const gap = columns === 2 ? 10 : columns === 3 ? 12 : 16
    const actualCardWidth = (Math.min(viewport, 1470) - padding - gap * (columns - 1)) / columns
    assert.ok(Math.abs(slotWidth(image.sizes, viewport) - actualCardWidth) < 1, `sizes must match the grid at ${viewport}px`)
  }
  assert.ok(slotWidth(image.sizes, 2431) < 342)
})

test("non-shop cards retain normal scheduling and gallery priority still preloads", () => {
  const card = product(0)
  card.images = [{ url: card.thumbnail }, { url: "/audit/back.webp" }]
  const [main, hover] = imageTags(renderToStaticMarkup(React.createElement(ProductCard, { product: card })))
  assert.equal(main.loading, "lazy")
  assert.equal(main.fetchpriority, undefined, "shop low priority must not leak to other grids")
  assert.equal(hover.loading, "lazy")
  assert.equal(hover.fetchpriority, undefined)

  const galleryMarkup = renderToStaticMarkup(React.createElement(ProductImage, {
    src: "/audit/hero.webp", alt: "Hero", priority: true, sizes: "60vw",
  }))
  const [hero] = imageTags(galleryMarkup)
  assert.equal(hero.loading, undefined)
  assert.equal(hero.sizes, "60vw")
  assert.ok(galleryMarkup.includes('rel="preload"'))

  const missing = renderToStaticMarkup(React.createElement(ProductImage, { src: null, alt: "Missing Design" }))
  assert.equal(imageTags(missing).length, 0)
  assert.ok(missing.includes('aria-label="Missing Design"'))
})

test("a deferred image cannot accidentally emit a preload even if a caller sets priority", () => {
  const markup = renderToStaticMarkup(React.createElement(ProductImage, {
    src: "/audit/later.webp", alt: "Later", sizes: "341px", deferred: true, priority: true,
  }))
  assert.ok(markup.startsWith("<noscript>"))
  assert.ok(!markup.includes('rel="preload"'))
  assert.equal(imageTags(markup)[0].loading, "lazy")
})
