const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const { renderToStaticMarkup } = require("react-dom/server")
const ts = require("typescript")

const settings = {
  eyebrow: "Get in touch", title: "Your questions, answered", description: "Updated owner introduction.",
  phone_label: "Call our team", phone: "+8801700000000", phone_note: "Updated phone hours",
  email_label: "Write to us", email: "contact@example.invalid", email_note: "Updated reply hours",
  address_label: "Find us", address: "Updated first line\nUpdated second line", address_note: "Updated address note",
  faq_eyebrow: "Helpful answers", faq_title: "Before you call", faq_description: "Updated FAQ introduction",
  help_title: "Need something else?", help_description: "Updated help description",
  faqs: [
    { id: "second", question: "Second question moved first?", answer: "The owner's first answer." },
    { id: "first", question: "First question moved second?", answer: "The owner's second answer." },
  ],
}

function contact(value = settings) {
  const filename = path.join(__dirname, "../src/app/contact/page.tsx")
  const source = fs.readFileSync(filename, "utf8")
  const code = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "@/lib/contact") return { getContactSettings: async () => value }
    if (name === "./contact.css") return {}
    if (["react/jsx-runtime", "lucide-react"].includes(name)) return require(name)
    throw new Error(`Unexpected Contact dependency ${name}`)
  } }, { filename })
  return { source, page: exports, render: async () => renderToStaticMarkup(await exports.default()) }
}

test("Contact SSR renders edited business details and preserves saved FAQ order", async () => {
  const html = await contact().render()
  for (const text of [settings.title, settings.description, settings.phone_label, settings.phone_note,
    settings.email_label, settings.email_note, settings.address_label, settings.address,
    settings.address_note, settings.faq_title, settings.faq_description, settings.help_title, settings.help_description]) {
    assert.ok(html.includes(text), text)
  }
  assert.ok(html.indexOf(settings.faqs[0].question) < html.indexOf(settings.faqs[1].question))
  assert.match(html, /href="tel:\+8801700000000"/)
  assert.match(html, /href="mailto:contact@example\.invalid"/)
})

test("FAQ interactions use native details and summary with only the first answer initially open", async () => {
  const h = contact()
  const html = await h.render()
  const details = html.match(/<details\b[^>]*>/g)
  assert.equal(details.length, 2)
  assert.match(details[0], /\bopen=""/)
  assert.doesNotMatch(details[1], /\bopen/)
  assert.equal((html.match(/<summary>/g) || []).length, 2)
  assert.ok(details.every((tag) => tag.includes('name="contact-questions"')))
  assert.doesNotMatch(h.source, /^[\s\uFEFF]*["']use client["']/)
  assert.doesNotMatch(html, /<script\b/)
})

test("cleared channels, address and FAQs do not revive defaults or leave empty navigation", async () => {
  const html = await contact({ ...settings, phone: "", email: "", address: "", faqs: [] }).render()
  assert.match(html, /Your questions, answered/)
  assert.doesNotMatch(html, /href="(?:tel:|mailto:|#contact-faq)|<address\b|<details\b/)
  assert.doesNotMatch(html, /class="contact-(?:channels|address|faq|help)"/)
  assert.doesNotMatch(html, /info@florayn|1310007055|Aftabnagar|Common questions/)
})

test("a single saved channel is the only contact action and blank optional copy stays hidden", async () => {
  const html = await contact({ ...settings, phone: "", eyebrow: "", description: "", email_note: "",
    address_note: "", faq_eyebrow: "", faq_description: "", help_title: "", help_description: "" }).render()
  assert.match(html, /href="mailto:contact@example\.invalid"/)
  assert.doesNotMatch(html, /href="tel:|contact-description|contact-channel-note|contact-help"|contact-eyebrow/)
})

test("Contact renders plain text safely even when handed HTML-like copy", async () => {
  const html = await contact({ ...settings, title: '<script>alert("title")</script>',
    description: 'One & two <strong>literal</strong>', address: '<img src=x onerror="alert(1)">',
    faqs: [{ id: "plain", question: "<b>Question</b>", answer: '<script>alert("answer")</script>' }],
  }).render()
  assert.match(html, /&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/)
  assert.match(html, /One &amp; two &lt;strong&gt;literal&lt;\/strong&gt;/)
  assert.match(html, /&lt;b&gt;Question&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script\b|<img\b|<strong>literal/)
})

test("Contact metadata uses saved copy and retains its contractual canonical route", async () => {
  const metadata = await contact().page.generateMetadata()
  assert.equal(metadata.title, settings.title)
  assert.equal(metadata.description, settings.description)
  assert.equal(metadata.alternates.canonical, "/contact/")
})
