/**
 * The review emails, word for word from florayn.com's florayn-core plugin
 * (review-requests.php and review-rewards.php): the same subject lines, copy,
 * colours and layout. Pure functions, so they are tested without sending.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/** 15, not 15.00. */
export function formatPct(pct: number): string {
  return String(Number(pct.toFixed(2)))
}

export type RequestProduct = {
  title: string
  thumbnail: string | null
  /** Star links, 1..5 in order. */
  starLinks: string[]
}

/** A. "How is your Florayn order?" — one per order, up to four products. */
export function reviewRequestEmail(input: {
  firstName: string | null
  products: RequestProduct[]
  photoPct: number
  textPct: number
  rewardsOn: boolean
}): { subject: string; html: string; text: string } {
  const name = escapeHtml(input.firstName?.trim() || "there")
  const offer = input.rewardsOn && (input.photoPct > 0 || input.textPct > 0)
    ? `<div style="background:#f5f5f7;border-radius:10px;padding:14px;text-align:center;margin:18px 0">Add a photo with your review and get <strong>${formatPct(input.photoPct)}% off</strong> your next order &mdash; a few words alone gets <strong>${formatPct(input.textPct)}% off</strong>.</div>`
    : ""
  const rows = input.products.map((p) => {
    const stars = p.starLinks.map((href) => `<a href="${escapeHtml(href)}" style="color:#f0a500;text-decoration:none">&#9733;</a>`).join("")
    const image = p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" width="64" height="64" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;display:block">` : ""
    return `<tr><td style="border-top:1px solid #eee;padding:14px 0;width:76px;vertical-align:middle">${image}</td><td style="border-top:1px solid #eee;padding:14px 0;vertical-align:middle"><strong>${escapeHtml(p.title)}</strong><div style="font-size:24px;letter-spacing:4px;line-height:1.2;margin-top:4px">${stars}</div></td></tr>`
  }).join("")
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;max-width:540px;margin:0 auto;line-height:1.5">`
    + `<p>Hi ${name},</p>`
    + `<p>Hope you are enjoying your order. How was it? Tap the stars to leave a quick review.</p>`
    + offer
    + `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${rows}</table>`
    + `<p style="font-size:12px;color:#86868b;margin-top:24px">You are getting this because you ordered from Florayn.</p>`
    + `</div>`
  const text = [
    `Hi ${input.firstName?.trim() || "there"},`,
    "Hope you are enjoying your order. How was it? Leave a quick review:",
    ...input.products.map((p) => `${p.title}: ${p.starLinks[4]}`),
    "You are getting this because you ordered from Florayn.",
  ].join("\n\n")
  return { subject: "How is your Florayn order?", html, text }
}

/** C. "Your N% off code from Florayn" — sent when a rewarded review is published. */
export function rewardEmail(input: {
  author: string | null
  product: string
  withPhotos: boolean
  code: string
  pct: number
  expiryDays: number
  shopUrl: string
}): { subject: string; html: string; text: string } {
  const pct = formatPct(input.pct)
  const valid = input.expiryDays > 0 ? `, valid for ${input.expiryDays} days` : ""
  const name = escapeHtml(input.author?.trim() || "there")
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;max-width:520px;margin:0 auto;line-height:1.5">`
    + `<p>Hi ${name},</p>`
    + `<p>Thank you for reviewing <strong>${escapeHtml(input.product)}</strong>${input.withPhotos ? " with photos" : ""}. Here is your discount for your next order:</p>`
    + `<div style="font-size:26px;font-weight:700;letter-spacing:2px;background:#f5f5f7;padding:16px;text-align:center;border-radius:10px;margin:18px 0">${escapeHtml(input.code)}</div>`
    + `<p style="text-align:center">${pct}% off, one use${valid}.</p>`
    + `<p style="text-align:center;margin:22px 0"><a href="${escapeHtml(input.shopUrl)}" style="background:#1d1d1f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block">Shop now</a></p>`
    + `<p style="font-size:12px;color:#86868b">Enter the code at checkout. It works once.</p>`
    + `</div>`
  const text = [
    `Hi ${input.author?.trim() || "there"},`,
    `Thank you for reviewing ${input.product}${input.withPhotos ? " with photos" : ""}. Here is your discount for your next order:`,
    input.code,
    `${pct}% off, one use${valid}.`,
    `Shop now: ${input.shopUrl}`,
  ].join("\n\n")
  return { subject: `Your ${pct}% off code from Florayn`, html, text }
}
