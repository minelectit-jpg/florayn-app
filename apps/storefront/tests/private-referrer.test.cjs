const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match")
const { modifyRouteRegex } = require("next/dist/lib/redirect-status")
const ts = require("typescript")

// No referrer leaves a private page (TRACKING.md 4.1): next.config.ts sends
// Referrer-Policy: no-referrer for /order, /review and /account, and the
// review link's page says so in its metadata too. The header rules are
// matched with Next's own matcher, built the way its router server builds a
// custom header route, so they reach every private address and no other route.
const root = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
const NO_REFERRER = [{ key: "Referrer-Policy", value: "no-referrer" }]

/** next.config.ts evaluated as Next does: an ES module, in its own directory. */
async function loadConfig() {
  const code = ts.transpileModule(read("next.config.ts"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "next.config.ts",
  }).outputText.replaceAll("import.meta.dirname", JSON.stringify(root))
  return (await import(`data:text/javascript,${encodeURIComponent(code)}`)).default
}

/** lib/tracking/paths.ts, the list the tracker treats as private. */
function paths() {
  const module = { exports: {} }
  const code = ts.transpileModule(read("src/lib/tracking/paths.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports })
  return { segments: [...module.exports.PRIVATE_SEGMENTS], isPrivatePath: module.exports.isPrivatePath }
}

const matcher = (source) => getPathMatch(source, {
  strict: true,
  removeUnnamedParams: true,
  regexModifier: (regex) => modifyRouteRegex(regex),
})

test("next.config.ts sends Referrer-Policy: no-referrer on every private page and on no other route", async () => {
  const config = await loadConfig()
  const rules = await config.headers()
  const { segments, isPrivatePath } = paths()
  assert.deepEqual(rules.map((rule) => rule.source), segments.map((segment) => `/${segment}/:path*`))
  for (const rule of rules) assert.deepEqual(rule.headers, NO_REFERRER, `${rule.source} sends only the referrer policy`)
  const covered = (pathname) => rules.some((rule) => matcher(rule.source)(pathname))

  for (const pathname of ["/order/order_01K6EXAMPLE/", "/order/order_01K6EXAMPLE", "/review/order_01ABC.sig1/", "/review/order_01ABC.sig1",
    "/review/", "/account/", "/account", "/account/login/"]) {
    assert.equal(isPrivatePath(pathname), true, pathname)
    assert.equal(covered(pathname), true, pathname)
  }
  for (const pathname of ["/", "/shop/", "/product/zebra/", "/product/review-case/", "/reviews/", "/orders/", "/accounting/",
    "/collection/order/", "/men/", "/men/shop/", "/men/product/zebra/", "/privacy/", "/checkout/", "/cart/", "/api/t/e/", "/api/t/id/",
    "/api/build-id/", "/_next/static/chunks/app/layout.js", "/search-index.json", "/sitemap-index.xml"]) {
    assert.equal(covered(pathname), false, pathname)
  }

  // Every private route folder that exists gets the header, /men forms included.
  for (const segment of segments) {
    assert.ok(fs.existsSync(path.join(root, "src/app", segment)), `app/${segment}`)
    if (fs.existsSync(path.join(root, "src/app/men", segment))) {
      assert.equal(covered(`/men/${segment}/x/`), true, `app/men/${segment} exists, so /men/${segment}/ needs the header`)
    }
  }
})

test("the rest of next.config.ts is unchanged: headers() is the only addition", async () => {
  const config = await loadConfig()
  assert.deepEqual(Object.keys(config).sort(), ["cacheHandler", "env", "eslint", "experimental", "headers", "images",
    "outputFileTracingRoot", "staticPageGenerationTimeout", "trailingSlash"])
  assert.equal(config.trailingSlash, true)
  assert.equal(config.cacheHandler, path.join(root, "cache-handler.js"))
  assert.equal(config.outputFileTracingRoot, root)
  assert.equal(config.staticPageGenerationTimeout, 120)
  assert.equal(typeof config.env.NEXT_PUBLIC_BUILD_ID, "string")
  assert.deepEqual(config.eslint, { ignoreDuringBuilds: true })
  assert.deepEqual(config.experimental, { serverActions: { bodySizeLimit: "4mb" } })
  assert.equal(config.images.minimumCacheTTL, 2678400)
})

test("the review link's page, like an order's, asks for no referrer in its metadata", () => {
  assert.match(read("src/app/review/[token]/page.tsx"), /^export const metadata: Metadata = \{[^\n]*\breferrer: "no-referrer" \}$/m)
  assert.match(read("src/app/order/[id]/page.tsx"), /\breferrer: "no-referrer" \}/)
})
