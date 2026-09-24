import type { ReviewInvite } from "./review-invites"
import type { ReviewProgram } from "./review-program"
import type { TemplateMessage } from "./whatsapp"

/**
 * The review programme on WhatsApp. Two templates, created once in the
 * shop's WhatsApp Business account (Admin > Reviews > WhatsApp submits them)
 * and approved by Meta:
 *
 *   request  "Hi {{1}}, thank you for shopping with Florayn! How do you like
 *            your {{2}}? {{3}} Tap the button below to write your review."
 *            + a "Write a review" button to <shop>/review/{{1}}
 *   reward   "Thank you for your review, {{1}}! Here is your {{2}} off code
 *            for your next Florayn order: {{3}}. It works once and is valid
 *            until {{4}}. Happy shopping!"
 *
 * Both are Marketing templates: they carry a discount, and Meta files review
 * requests that offer one as marketing.
 */

export const REVIEW_PAGE_PATH = "/review/"

/** "Moon Drift", "Moon Drift and Grape Goo", "Moon Drift, Grape Goo and 2 more". */
export function productPhrase(titles: string[]): string {
  const names = titles.filter(Boolean)
  if (!names.length) return "Florayn order"
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** The offer sentence in a request: what a review earns, or a plain nudge when rewards are off. */
export function offerSentence(settings: ReviewProgram): string {
  const w = settings.rewards
  if (!w.enabled || (!w.photo_pct && !w.text_pct)) return "It only takes a minute."
  if (w.photo_pct && w.text_pct) return `Add a photo with your review and get ${w.photo_pct}% off your next order (${w.text_pct}% for a few words).`
  return `Leave a review and get ${w.photo_pct || w.text_pct}% off your next order.`
}

/** The page a request's button opens: the order's products, each with its review form. */
export function reviewPageUrl(storefront: string, token: string): string {
  return `${storefront}${REVIEW_PAGE_PATH}${encodeURIComponent(token)}`
}

export function requestTemplateMessage(settings: ReviewProgram, invite: ReviewInvite, to: string, token: string): TemplateMessage {
  return {
    to,
    name: settings.whatsapp.request_template,
    language: settings.whatsapp.language,
    body: [invite.firstName || "there", productPhrase(invite.products.map((p) => p.title)), offerSentence(settings)],
    buttonUrl: token,
  }
}

/** "24 Nov 2026" - the code's last day, or the words for a code that never expires. */
export function expiryWords(issuedAt: Date, expiryDays: number): string {
  if (!expiryDays) return "you use it"
  const ends = new Date(issuedAt.getTime() + expiryDays * 86_400_000)
  return ends.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
}

export function rewardTemplateMessage(settings: ReviewProgram, reward: { author: string; code: string; pct: number; issuedAt: Date }, to: string): TemplateMessage {
  return {
    to,
    name: settings.whatsapp.reward_template,
    language: settings.whatsapp.language,
    body: [reward.author || "there", `${reward.pct}%`, reward.code, expiryWords(reward.issuedAt, settings.rewards.expiry_days)],
  }
}

/** Fill {placeholders}; unknown ones are left as written so a typo shows. */
export function fillText(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all))
}

/** The request typed into WhatsApp by the admin's button (sent by hand). */
export function manualRequestText(settings: ReviewProgram, invite: ReviewInvite, link: string): string {
  const rewardsOn = settings.rewards.enabled && (settings.rewards.photo_pct > 0 || settings.rewards.text_pct > 0)
  const lines = settings.whatsapp.manual_request_text
    .split("\n")
    .filter((line) => rewardsOn || !/\{(photo_pct|text_pct)\}/.test(line))
  return fillText(lines.join("\n"), {
    name: invite.firstName || "there",
    product: productPhrase(invite.products.map((p) => p.title)),
    link,
    photo_pct: String(settings.rewards.photo_pct),
    text_pct: String(settings.rewards.text_pct),
  }).trim()
}

/** A review's code typed into WhatsApp by the admin's button (sent by hand). */
export function manualRewardText(settings: ReviewProgram, reward: { author: string; code: string; pct: number; issuedAt: Date }, shop: string): string {
  const until = settings.rewards.expiry_days ? ` until ${expiryWords(reward.issuedAt, settings.rewards.expiry_days)}` : ""
  return fillText(settings.whatsapp.manual_reward_text, {
    name: reward.author || "there",
    code: reward.code,
    pct: String(reward.pct),
    until,
    shop,
  }).trim()
}

/**
 * The two templates as WhatsApp Manager's API wants them, to submit from the
 * admin. Every {{n}} needs an example value for Meta's review.
 */
export function templateDefinitions(settings: ReviewProgram, storefront: string) {
  const language = settings.whatsapp.language
  return [
    {
      key: "request" as const,
      name: settings.whatsapp.request_template,
      language,
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text: "Hi {{1}}, thank you for shopping with Florayn! How do you like your {{2}}? {{3}} Tap the button below to write your review.",
          example: { body_text: [["Ayesha", "Moon Drift", "Add a photo with your review and get 15% off your next order (10% for a few words)."]] },
        },
        {
          type: "BUTTONS",
          buttons: [{
            type: "URL",
            text: "Write a review",
            url: `${storefront}${REVIEW_PAGE_PATH}{{1}}`,
            example: [`${storefront}${REVIEW_PAGE_PATH}order_01EXAMPLE.aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY`],
          }],
        },
      ],
    },
    {
      key: "reward" as const,
      name: settings.whatsapp.reward_template,
      language,
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text: "Thank you for your review, {{1}}! Here is your {{2}} off code for your next Florayn order: {{3}}. It works once and is valid until {{4}}. Happy shopping!",
          example: { body_text: [["Ayesha", "15%", "REVK7Q2MX", "24 Nov 2026"]] },
        },
      ],
    },
  ]
}

/** The template texts, for the admin to read (or paste into WhatsApp Manager by hand). */
export function templatePreview(settings: ReviewProgram, storefront: string) {
  return templateDefinitions(settings, storefront).map((t) => ({
    key: t.key,
    name: t.name,
    language: t.language,
    category: t.category,
    body: (t.components.find((c) => c.type === "BODY") as any).text as string,
    button: ((t.components.find((c) => c.type === "BUTTONS") as any)?.buttons?.[0] ?? null) as { text: string; url: string } | null,
  }))
}
