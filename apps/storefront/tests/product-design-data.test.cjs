const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const zlib = require("node:zlib")
const ts = require("typescript")

const compiled = ts.transpileModule(fs.readFileSync(
  path.join(__dirname, "../src/lib/product-view-data.ts"), "utf8"
), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loaded = { exports: {} }
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports })
const { productViewDesigns, expandProductViewDesigns } = loaded.exports
const plain = (value) => JSON.parse(JSON.stringify(value))

function variant(id, device, caseType, price, image) {
  return {
    id,
    options: [
      ...(device == null ? [] : [{ option_id: "device", value: device }]),
      ...(caseType == null ? [] : [{ option_id: "case", value: caseType }]),
    ],
    calculated_price: price == null ? null : { calculated_amount: price, currency_code: "bdt" },
    metadata: { images: image == null ? [] : [image] },
  }
}

function product(id, variants) {
  return {
    id,
    handle: `${id}-phone-case`,
    title: `${id} Phone Case`,
    metadata: { design_slug: id, design_name: `Design ${id}` },
    thumbnail: `https://images.example/${id}/thumbnail.webp`,
    options: [{ id: "device", title: "Device" }, { id: "case", title: "Case Type" }],
    variants,
  }
}

function roundTrip(products, featured = products) {
  const data = plain(productViewDesigns(products, featured))
  return { data, ...plain(expandProductViewDesigns(data)) }
}

test("every model/case choice keeps its image, price and exact cart variant", () => {
  const devices = ["iPhone 17 Pro Max", "iPhone 13", "Samsung Galaxy S26 Ultra"]
  const cases = ["Signature", "Armor", "MagSafe", "Alcantara"]
  const choices = devices.flatMap((device, d) => cases.map((caseType, c) =>
    variant(`variant_${d}_${c}`, device, caseType, 1200 + d * 300 + c * 75, `https://images.example/${d}/${c}.webp`)
  ))
  const source = product("sunburst", choices)
  const before = JSON.stringify(source)
  const result = roundTrip([source])
  assert.equal(result.data.designs.length, 1)
  assert.deepEqual(result.data.more, [0])
  assert.deepEqual(result.data.packs, [0])
  assert.deepEqual(result.data.featured, [0])
  for (const choice of choices) {
    const key = `${choice.options[0].value}|${choice.options[1].value}`
    const price = choice.calculated_price.calculated_amount
    const image = choice.metadata.images[0]
    assert.equal(result.moreDesignItems[0].imageByPair[key], image)
    assert.equal(result.youWillLoveItems[0].imageByPair[key], image)
    assert.deepEqual(result.youWillLoveItems[0].variantByPair[key], { id: choice.id, price })
    assert.deepEqual(result.packDesigns[0].variants[key], { variantId: choice.id, price, image })
  }
  // A mixed-device/case pack retains each slot's own cart ID and price.
  const pack = result.packDesigns[0].variants
  assert.deepEqual([
    pack["iPhone 17 Pro Max|Signature"],
    pack["Samsung Galaxy S26 Ultra|Alcantara"],
  ].map((choice) => [choice.variantId, choice.price]), [
    ["variant_0_0", 1200], ["variant_2_3", 2025],
  ])
  assert.equal(result.moreDesignItems[0].handle, "sunburst-phone-case")
  assert.equal(result.packDesigns[0].handle, "sunburst")
  assert.equal(JSON.stringify(source), before)
})

test("fallbacks, duplicate pairs and unresolved prices retain existing behavior", () => {
  const source = product("edge", [
    variant("unpriced_first", "Phone A", "Signature", null, null),
    variant("priced_second", "Phone A", "Signature", 1800, "second.webp"),
    variant("cheaper_third", "Phone A", "Signature", 1500, "third.webp"),
    variant("no_image", "Phone B", "Armor", 1950, null),
    variant("device_only", "Phone C", null, 1600, "device.webp"),
    variant("no_device", null, "Armor", 100, "orphan.webp"),
    variant("free", "Phone D", "Signature", 0, "free.webp"),
    variant("empty_image", "Phone E", "Signature", 1700, ""),
  ])
  const result = roundTrip([source])
  const more = result.moreDesignItems[0]
  const featured = result.youWillLoveItems[0]
  const pack = result.packDesigns[0]
  assert.equal(more.imageByPair["Phone A|Signature"], "second.webp")
  assert.equal(more.imageByDevice["Phone A"], "second.webp")
  assert.equal(more.imageByDevice["Phone C"], "device.webp")
  assert.equal(more.imageByDevice["Phone E"], undefined)
  assert.equal(more.price, 0)
  assert.deepEqual(featured.variantByPair["Phone A|Signature"], { id: "unpriced_first", price: 0 })
  assert.deepEqual(pack.variants["Phone A|Signature"], { variantId: "priced_second", price: 1800, image: "second.webp" })
  assert.equal(pack.variants["Phone B|Armor"].image, source.thumbnail)
  assert.equal(pack.variants["Phone E|Signature"].image, "")
  assert.equal(pack.variants["Phone D|Signature"], undefined)
  assert.equal(Object.keys(pack.variants).length, 3)
})

test("all packs and featured ordering survive the twelve-card strip limit", () => {
  const products = Array.from({ length: 15 }, (_, i) => product(`design_${i}`, [
    variant(`variant_${i}`, "Phone", "Signature", 1400, "shared.webp"),
  ]))
  const external = product("other_collection", [variant("outside", "Phone", "Armor", 1900, "shared.webp")])
  const result = roundTrip(products, [products[14], external, products[0], products[14]])
  assert.equal(result.data.designs.length, 16)
  assert.deepEqual(result.data.images, ["shared.webp"])
  assert.equal(result.moreDesignItems.length, 12)
  assert.equal(result.packDesigns.length, 15)
  assert.deepEqual(result.youWillLoveItems.map((item) => item.id), ["design_14", "other_collection", "design_0", "design_14"])
})

test("different cached snapshots of one product are never merged by ID", () => {
  const pool = product("same", [variant("old_variant", "Phone", "Signature", 1400, "old.webp")])
  const featured = product("same", [variant("new_variant", "Phone", "Signature", 1500, "new.webp")])
  const result = roundTrip([pool], [featured])
  assert.equal(result.data.designs.length, 2)
  assert.equal(result.packDesigns[0].variants["Phone|Signature"].variantId, "old_variant")
  assert.equal(result.youWillLoveItems[0].variantByPair["Phone|Signature"].id, "new_variant")
  assert.equal(result.moreDesignItems[0].imageByPair["Phone|Signature"], "old.webp")
  assert.equal(result.youWillLoveItems[0].imageByPair["Phone|Signature"], "new.webp")
})

test("missing options, empty products and no selections remain safe", () => {
  const noOptions = product("regular", [variant("one", "Phone", "Signature", 100, "one.webp")])
  noOptions.options = []
  const result = roundTrip([noOptions, product("empty", [])])
  for (const pack of result.packDesigns) assert.deepEqual(pack.variants, {})
  for (const item of result.moreDesignItems) assert.deepEqual(item.imageByPair, {})
  assert.deepEqual(roundTrip([]).data.designs, [])
})

test("large catalog payload stays below half the expanded section JSON", () => {
  const products = Array.from({ length: 12 }, (_, p) => product(`design_${p}`, Array.from({ length: 156 }, (_, i) =>
    variant(`variant_${p}_${i}`, `Phone model ${Math.floor(i / 4)}`, `Case type ${i % 4}`, 1400 + (i % 4) * 150,
      `https://images.example/catalog/render-${p}-${i}-7f6050f65427468fb3e76f6db8c5d31e.webp`)
  )))
  const data = plain(productViewDesigns(products, products.slice(0, 4)))
  const expanded = plain(expandProductViewDesigns(data))
  const sharedJSON = JSON.stringify(data)
  const expandedJSON = JSON.stringify(expanded)
  assert.equal(data.designs.length, 12)
  assert.ok(Buffer.byteLength(sharedJSON) < Buffer.byteLength(expandedJSON) * 0.5)
  assert.ok(zlib.gzipSync(sharedJSON).length < zlib.gzipSync(expandedJSON).length)
  assert.equal(expanded.packDesigns.flatMap((design) => Object.keys(design.variants)).length, 1872)
})

test("observed catalog dimensions fit a fixed 215 KB related-data budget", () => {
  // Synthetic equivalent of the measured PDP: 39 models, 102 compatible pairs
  // per design, 11 sibling designs and 4 picks (3 overlaps, 1 external design).
  // IDs match Medusa's 34 characters; every image URL uses the observed 104-char
  // maximum. No production identifiers, URLs or catalog content are committed.
  const products = Array.from({ length: 12 }, (_, p) => {
    const variants = Array.from({ length: 39 }, (_, d) =>
      Array.from({ length: d < 21 ? 4 : 1 }, (_, c) => {
        const digest = createHash("sha256").update(`${p}:${d}:${c}`).digest("hex")
        return variant(`variant_${digest.slice(0, 26)}`, `Phone model ${d}`, `Case type ${c}`,
          1400 + c * 150, `https://images.example/${digest}`.padEnd(99, "0") + ".webp")
      })
    ).flat()
    return product(`design_${p}`, variants)
  })
  const data = plain(productViewDesigns(products.slice(0, 11), products.slice(8, 12)))
  const expanded = plain(expandProductViewDesigns(data))
  const bytes = Buffer.byteLength(JSON.stringify(data))
  assert.equal(data.designs.length, 12)
  assert.equal(data.devices.length, 39)
  assert.equal(data.designs.reduce((sum, design) => sum + design.variants.length, 0), 1224)
  assert.ok(bytes <= 215000, `Related data exceeded 215000 bytes: ${bytes}`)
  assert.ok(bytes < Buffer.byteLength(JSON.stringify(expanded)) * 0.45)
})
