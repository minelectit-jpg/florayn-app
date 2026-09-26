const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const ts = require("typescript")

// The Privacy page (TRACKING.md WP09): Admin > Privacy text rendered as plain
// text once published, today's placeholder otherwise.
const plain = (value) => JSON.parse(JSON.stringify(value))
const compile = (filename, jsx) => ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText

// The /privacy/ markup before WP09, which must survive exactly while unpublished.
const PLACEHOLDER = '<div class="mx-auto max-w-2xl space-y-5 py-10"><h1 class="display text-[2.25rem] leading-tight">Privacy policy</h1>' +
  '<p class="text-ink-muted">This page has not been written yet. The wording needs to come from Florayn rather than be drafted here.</p>' +
  '<p class="text-sm text-ink-muted">In the meantime, <a href="/contact/" class="underline underline-offset-4 transition-colors hover:text-purple">contact us</a>' +
  " with any question about an order.</p></div>"

function lib(response = {}, options = {}) {
  const filename = path.join(__dirname, "../src/lib/privacy.ts")
  const calls = []
  const exports = {}
  let cacheWrappers = 0
  vm.runInNewContext(compile(filename), {
    exports,
    process: { env: { NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://backend.invalid", NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_fixture_only" } },
    AbortSignal: { timeout: (milliseconds) => ({ timeout: milliseconds }) },
    fetch: async (url, init) => {
      calls.push({ url, ...plain(init) })
      if (options.networkFailure) throw new Error("offline")
      return { ok: options.status == null || options.status < 400, async json() {
        if (options.invalidJson) throw new Error("Invalid JSON")
        return response
      } }
    },
    require(name) {
      if (name === "react") return { cache: (fn) => {
        cacheWrappers++
        let result
        return () => result ??= fn()
      } }
      throw new Error(`Unexpected dependency ${name}: the Privacy page must not load the catalog or SDK`)
    },
  }, { filename })
  return { ...exports, calls, get cacheWrappers() { return cacheWrappers } }
}

const { parsePrivacyBody } = lib()

function page(value) {
  const filename = path.join(__dirname, "../src/app/privacy/page.tsx")
  const exports = {}
  vm.runInNewContext(compile(filename, true), { exports, require(name) {
    if (name === "@/lib/privacy") return { getPrivacy: async () => value, parsePrivacyBody }
    if (name === "next/link") return { __esModule: true, default: ({ prefetch, children, ...props }) => React.createElement("a", props, children) }
    if (name === "react/jsx-runtime") return require(name)
    throw new Error(`Unexpected Privacy page dependency ${name}`)
  } }, { filename })
  return { page: exports, render: async () => renderToStaticMarkup(await exports.default()) }
}

const BODY = [
  "We sell cases.\nMade in Dhaka.",
  "## What we collect",
  "Your name & phone.",
  "- _fl_vid: a visitor id\n- _fl_sid: your visit",
  "<script>alert(\"x\")</script> stays <b>text</b>",
].join("\n\n")
const PUBLISHED = { title: "Privacy policy", body: BODY, published: true, updated_at: "2026-09-27T20:30:00.000Z" }

test("the body parser makes headings, paragraphs and lists from plain text and never HTML", () => {
  assert.deepEqual(plain(parsePrivacyBody(BODY)), [
    { kind: "paragraph", text: "We sell cases.\nMade in Dhaka." },
    { kind: "heading", text: "What we collect" },
    { kind: "paragraph", text: "Your name & phone." },
    { kind: "list", items: ["_fl_vid: a visitor id", "_fl_sid: your visit"] },
    { kind: "paragraph", text: "<script>alert(\"x\")</script> stays <b>text</b>" },
  ])
  assert.deepEqual(plain(parsePrivacyBody("Intro:\r\n- one\r\n-\r\n- two\r\nAfter\r\n \r\n##No heading\r\n## \r\n-5 days")), [
    { kind: "paragraph", text: "Intro:" },
    { kind: "list", items: ["one", "two"] },
    { kind: "paragraph", text: "After" },
    { kind: "paragraph", text: "##No heading" },
    { kind: "paragraph", text: "-5 days" },
  ])
  for (const value of [undefined, null, 42, {}, "", "  \n\n  "]) assert.deepEqual(plain(parsePrivacyBody(value)), [])
})

test("the suggested draft renders as seven sections with its cookie, retention and choices lists", () => {
  const filename = path.join(__dirname, "../../backend/src/modules/content/privacy-draft.ts")
  const draft = {}
  vm.runInNewContext(compile(filename), { exports: draft }, { filename })
  const blocks = plain(parsePrivacyBody(draft.SUGGESTED_PRIVACY_BODY))
  assert.deepEqual(blocks.filter((block) => block.kind === "heading").map((block) => block.text), [
    "What you give us when you order", "What we record while you browse", "Advertising partners",
    "Cookies we use", "How long we keep it", "Your choices", "Contact",
  ])
  assert.deepEqual(blocks.filter((block) => block.kind === "list").map((block) => block.items.length), [9, 4, 3])
  assert.equal(blocks[0].kind, "paragraph")
})

test("a published page renders its title, text, Dhaka date and the opt-out links as plain text", async () => {
  const html = await page(PUBLISHED).render()
  assert.match(html, /<h1 class="display[^"]*">Privacy policy<\/h1>/)
  assert.match(html, /<h2[^>]*>What we collect<\/h2>/)
  assert.match(html, /<p[^>]*>We sell cases.\nMade in Dhaka.<\/p>/)
  assert.match(html, /<ul[^>]*><li>_fl_vid: a visitor id<\/li><li>_fl_sid: your visit<\/li><\/ul>/)
  assert.match(html, /Your name &amp; phone\./)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; stays &lt;b&gt;text&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script\b|<b>/)
  // 20:30 UTC on 27 September is already 28 September in Dhaka.
  assert.match(html, /Last updated 28 September 2026/)
  assert.ok(html.indexOf("What we collect") < html.indexOf("Last updated"))
  const links = html.match(/<a\b[^>]*>[^<]*<\/a>/g)
  assert.deepEqual(links.map((link) => link.match(/href="([^"]+)"/)[1]), ["/api/t/optout/?on=1", "/api/t/optout/?on=0"])
  assert.match(links[0], />Turn off ad measurement on this browser<\/a>$/)
  assert.match(links[1], />Turn it back on<\/a>$/)
  assert.ok(html.indexOf("Last updated") < html.indexOf("/api/t/optout/?on=1"))
  assert.doesNotMatch(html, /This page has not been written yet/)

  const untitled = await page({ ...PUBLISHED, title: "Our privacy notice", updated_at: null }).render()
  assert.match(untitled, /<h1[^>]*>Our privacy notice<\/h1>/)
  assert.doesNotMatch(untitled, /Last updated/)
  assert.match(untitled, /href="\/api\/t\/optout\/\?on=1"/)
})

test("the placeholder is kept exactly while unpublished, empty or unavailable, with no opt-out links", async () => {
  for (const value of [null, { ...PUBLISHED, published: false }, { ...PUBLISHED, body: "" },
    { ...PUBLISHED, body: "  \n\n  " }, { title: "Draft", body: "", published: false, updated_at: null }]) {
    const html = await page(value).render()
    assert.equal(html, PLACEHOLDER, JSON.stringify(value))
    assert.doesNotMatch(html, /optout|Last updated/)
  }
})

test("metadata keeps the title and canonical, and the page stays a static server component", () => {
  const { page: exported } = page(null)
  assert.equal(exported.metadata.title, "Privacy policy")
  assert.equal(exported.metadata.alternates.canonical, "/privacy/")
  assert.equal(exported.revalidate, 60)
  const source = fs.readFileSync(path.join(__dirname, "../src/app/privacy/page.tsx"), "utf8")
  assert.doesNotMatch(source, /^[\s﻿]*["']use client["']/)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|next\/headers|cookies\(|headers\(|searchParams|useSearchParams/)
})

test("the fetch is one small tagged read with the publishable key, shared through React cache", async () => {
  const h = lib({ settings: PUBLISHED })
  const [first, second] = await Promise.all([h.getPrivacy(), h.getPrivacy()])
  assert.equal(first, second)
  assert.deepEqual(plain(first), PUBLISHED)
  assert.equal(h.cacheWrappers, 1)
  assert.equal(h.calls.length, 1)
  const [request] = h.calls
  assert.equal(request.url, "http://backend.invalid/store/privacy-settings")
  assert.deepEqual(request.next, { revalidate: 60, tags: ["content", "content:privacy"] })
  assert.deepEqual(request.headers, { "x-publishable-api-key": "pk_fixture_only" })
  assert.ok(request.signal.timeout > 0 && request.signal.timeout <= 5000)
})

test("fetch errors and malformed responses return null, and bad fields never publish", async () => {
  for (const options of [{ status: 404 }, { status: 503 }, { invalidJson: true }, { networkFailure: true }]) {
    assert.equal(await lib({ settings: PUBLISHED }, options).getPrivacy(), null, JSON.stringify(options))
  }
  for (const response of [null, {}, { settings: null }, { settings: [] }, { settings: "text" }]) {
    assert.equal(await lib(response).getPrivacy(), null, JSON.stringify(response))
  }
  const odd = await lib({ settings: { title: "x".repeat(121), body: "Text", published: "true", updated_at: "soon", extra: "hidden" } }).getPrivacy()
  assert.deepEqual(plain(odd), { title: "Privacy policy", body: "Text", published: false, updated_at: null })
  const empty = await lib({ settings: { title: "T", body: "   ", published: true, updated_at: null } }).getPrivacy()
  assert.equal(empty.published, false)
  const huge = await lib({ settings: { title: "T", body: "x".repeat(20_001), published: true, updated_at: null } }).getPrivacy()
  assert.deepEqual(plain(huge), { title: "T", body: "", published: false, updated_at: null })
})
