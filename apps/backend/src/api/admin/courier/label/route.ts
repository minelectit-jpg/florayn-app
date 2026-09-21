import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  hydrateOrders,
  opsByOrderId,
  opsService,
  projectManagedOrder,
} from "../../../../lib/order-ops"

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const bdt = (n: number) => `${Math.round(n).toLocaleString("en-US")} BDT`

/**
 * GET /admin/courier/label?order_ids=a,b,c
 * A printable HTML sheet - one shipping label per order, with a Code128 barcode
 * of the Steadfast tracking code (rendered client-side; Steadfast has no label
 * API). Opened in a new tab from the order manager and printed with Ctrl+P.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const raw = (req.query.order_ids as string) || ""
  const orderIds = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (!orderIds.length) {
    res.status(400).setHeader("content-type", "text/html")
    return res.send("<p>No orders selected.</p>")
  }

  const [orders, ops] = await Promise.all([
    hydrateOrders(req.scope, orderIds),
    opsByOrderId(req.scope, orderIds),
  ])

  const labels = orderIds
    .map((id) => {
      const order = orders.get(id)
      if (!order) return ""
      const m = projectManagedOrder(order, ops.get(id))
      const tracking = m.steadfast_tracking_code
      return `
      <div class="label">
        <div class="brand">FLORAYN</div>
        <div class="row"><span class="k">Order</span><span class="v">#${esc(m.display_id ?? "")}</span></div>
        <div class="to">
          <div class="name">${esc(m.customer_name || "Customer")}</div>
          <div>${esc(m.phone)}</div>
          <div class="addr">${esc(m.address || m.district)}</div>
        </div>
        <div class="cod">COD: <b>${esc(bdt(m.total))}</b></div>
        ${
          tracking
            ? `<svg class="barcode" data-code="${esc(tracking)}"></svg><div class="track">${esc(tracking)}</div>`
            : `<div class="notsent">Not sent to courier yet</div>`
        }
      </div>`
    })
    .join("")

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shipping labels</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .label { width: 384px; padding: 16px 18px; border: 1px solid #111; margin: 10px; page-break-after: always; }
    .brand { font-weight: 800; letter-spacing: 2px; font-size: 18px; margin-bottom: 6px; }
    .row { display: flex; justify-content: space-between; font-size: 12px; border-top: 1px dashed #999; padding-top: 6px; }
    .to { margin: 8px 0; font-size: 13px; line-height: 1.4; }
    .to .name { font-weight: 700; font-size: 15px; }
    .to .addr { color: #333; }
    .cod { font-size: 14px; margin: 6px 0; }
    .barcode { width: 100%; height: 60px; }
    .track { text-align: center; font-family: monospace; font-size: 13px; letter-spacing: 1px; }
    .notsent { color: #a00; font-size: 12px; margin-top: 8px; }
    @media print { .label { border: 1px solid #000; margin: 0 auto; } @page { margin: 6mm; } }
  </style></head><body>
  ${labels}
  <script>
    document.querySelectorAll('.barcode').forEach(function (el) {
      try { JsBarcode(el, el.getAttribute('data-code'), { format: 'CODE128', displayValue: false, height: 55, margin: 0 }); } catch (e) {}
    });
    window.addEventListener('load', function () { setTimeout(function(){ try { window.print(); } catch(e){} }, 350); });
  </script>
  </body></html>`

  // Mark these as printed (fire-and-forget).
  const now = new Date()
  const printed = orderIds
    .map((id) => ops.get(id))
    .filter((op): op is NonNullable<typeof op> => Boolean(op))
    .map((op) => ({ id: op.id, label_printed_at: now }))
  if (printed.length) {
    try {
      await opsService(req.scope).updateOrderOps(printed)
    } catch {
      /* printing must not fail on a bookkeeping write */
    }
  }

  res.setHeader("content-type", "text/html; charset=utf-8")
  return res.send(html)
}
