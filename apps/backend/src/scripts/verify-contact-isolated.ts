import assert from "node:assert/strict"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../modules/content"
import { CONTACT_SETTINGS_ID, DEFAULT_CONTACT_SETTINGS, readContactSettings } from "../modules/content/contact-settings"
import type ContentModuleService from "../modules/content/service"
import { updateContactSettingsWorkflow } from "../workflows/update-contact-settings"

/** Synthetic settings only. Never run against an application database. */
export default async function verifyContactIsolated({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
  if (process.env.CONTACT_ISOLATED_TEST !== "1" ||
    !/^\/florayn_(?:contact|checkout)_test_[a-z0-9_]+$/.test(database.pathname) ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(process.env.STOREFRONT_URL ?? "") ||
    process.env.REVALIDATE_SECRET) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED,
      "This test requires CONTACT_ISOLATED_TEST=1, a disposable florayn_contact_test_* or florayn_checkout_test_* database and isolated storefront configuration.")
  }
  const service: ContentModuleService = container.resolve(CONTENT_MODULE)
  const existing = await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 1 })
  assert.equal(existing.length, 0, "Run on a fresh disposable contact singleton")
  assert.deepEqual(await readContactSettings(service), DEFAULT_CONTACT_SETTINGS)
  assert.equal((await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 1 })).length, 0,
    "Reading defaults must not insert rows")
  const save = async (input: Record<string, unknown>) =>
    (await updateContactSettingsWorkflow(container).run({ input })).result.settings
  const faqs = [
    { id: "fixture-one", question: "First fixture?", answer: "First answer." },
    { id: "fixture-two", question: "Second fixture?", answer: "Second answer.\nAnother line." },
  ]
  const first = await save({ title: "  Contact fixture  ", phone: "০১৩১০-০০৭০৫৫", email: "INFO@EXAMPLE.INVALID", faqs })
  assert.equal(first.title, "Contact fixture")
  assert.equal(first.phone, "+8801310007055")
  assert.equal(first.email, "info@example.invalid")
  assert.deepEqual(first.faqs, faqs)
  assert.deepEqual(await readContactSettings(service), first)
  const reordered = await save({ faqs: [faqs[1], { ...faqs[0], answer: "Updated answer." }], phone_note: "" })
  assert.deepEqual(reordered.faqs.map((faq) => faq.id), ["fixture-two", "fixture-one"])
  assert.equal(reordered.faqs[1].answer, "Updated answer.")
  assert.equal(reordered.phone_note, "")
  assert.equal(reordered.title, "Contact fixture")
  const cleared = await save({ phone: "", email: "", address: "", faqs: [] })
  assert.deepEqual(cleared.faqs, [])
  assert.equal(cleared.phone, "")
  assert.equal(cleared.email, "")
  assert.equal(cleared.address, "")
  assert.deepEqual(await readContactSettings(service), cleared)
  await assert.rejects(save({ phone: "javascript:alert(1)" }),
    (error: any) => typeof error?.message === "string" && error.message.includes("international phone"))
  assert.deepEqual(await readContactSettings(service), cleared)
  assert.equal((await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 2 })).length, 1)
  container.resolve(ContainerRegistrationKeys.LOGGER).info("CONTACT_INTEGRATION_PASS: read-only defaults, singleton create/update, FAQ reorder/edit/clear, safe contacts and persisted projection")
}
