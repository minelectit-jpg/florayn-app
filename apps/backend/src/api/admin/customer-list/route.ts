import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { localMobile, realEmail } from "../../../lib/contact"

const PAGE = 50

/**
 * GET /admin/customer-list?q=&offset=
 * Everyone who has ordered, newest order first: name, mobile, email, how many
 * orders, what they spent (cancelled and returned orders left out) and
 * whether they came over from florayn.com. `q` matches name, mobile or email.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const knex: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const offset = Math.max(0, Math.min(1_000_000, Number(req.query.offset) || 0))
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : ""
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`

  const base = () => {
    const query = knex("customer as c")
      .join("order as o", function (this: any) { this.on("o.customer_id", "=", "c.id").andOnNull("o.deleted_at") })
      .whereNull("c.deleted_at")
    if (q) {
      query.andWhere((w: any) => {
        w.orWhereILike("c.email", like)
          .orWhereILike("c.phone", like)
          .orWhereRaw("concat_ws(' ', c.first_name, c.last_name) ilike ?", [like])
          .orWhereExists(knex("order_address as a").whereRaw("a.id = o.shipping_address_id").andWhere((a: any) => a.orWhereILike("a.phone", like).orWhereRaw("concat_ws(' ', a.first_name, a.last_name) ilike ?", [like])))
      })
    }
    return query
  }

  const [rows, [{ count }]] = await Promise.all([
    base()
      .leftJoin("order_summary as s", function (this: any) { this.on("s.order_id", "=", "o.id").andOnNull("s.deleted_at") })
      .groupBy("c.id")
      .orderByRaw("max(o.created_at) desc")
      .limit(PAGE)
      .offset(offset)
      .select(
        "c.id", "c.first_name", "c.last_name", "c.email", "c.phone", "c.has_account",
        knex.raw("count(distinct o.id)::int as orders"),
        knex.raw("coalesce(sum(case when o.status = 'canceled' then 0 else (s.totals->>'current_order_total')::numeric end), 0)::float as spent"),
        knex.raw("max(o.created_at) as last_order"),
        knex.raw("min(o.created_at) as first_order"),
        knex.raw("bool_or(o.metadata->>'source' = 'florayn.com') as from_florayn"),
        knex.raw("(array_agg(o.id order by o.created_at desc))[1] as last_order_id"),
      ),
    base().countDistinct({ count: "c.id" }),
  ])

  // Name and mobile from the latest order when the customer record has none.
  const lastIds = rows.map((r: any) => r.last_order_id).filter(Boolean)
  const addresses = lastIds.length
    ? await knex("order as o").join("order_address as a", "a.id", "o.shipping_address_id").whereIn("o.id", lastIds).select("o.id", "a.first_name", "a.last_name", "a.phone", "a.province")
    : []
  const addressByOrder = new Map<string, any>(addresses.map((a: any) => [a.id, a]))

  res.json({
    count: Number(count) || 0, offset, limit: PAGE,
    customers: rows.map((r: any) => {
      const a = addressByOrder.get(r.last_order_id) ?? {}
      return {
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || [a.first_name, a.last_name].filter(Boolean).join(" ") || null,
        phone: localMobile(r.phone) ?? localMobile(a.phone) ?? (r.phone || a.phone || null),
        email: realEmail(r.email),
        district: a.province || null,
        account: Boolean(r.has_account),
        orders: r.orders,
        spent: Math.round(Number(r.spent) || 0),
        first_order: r.first_order,
        last_order: r.last_order,
        from_florayn: Boolean(r.from_florayn),
      }
    }),
  })
}
