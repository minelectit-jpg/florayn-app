import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /diagnose?token=... - read-only, temporary, off by default.
 *
 * Why this exists rather than another cron: the question is what the WEB
 * PROCESS sees. A cron runs in its own process with its own connection, so it
 * can only ever confirm what the database holds - it cannot explain why the
 * process serving /store/products disagrees with it. This runs inside that
 * process, on its own pool, so what it reports is what the request handler
 * would have found.
 *
 * It is disabled unless DIAGNOSE_TOKEN is set in the environment, and a
 * request without the matching token gets a 404 rather than a 403, so an
 * enabled endpoint is not advertised to anyone probing for it. Delete the
 * variable when the question is answered and the route goes dormant again.
 *
 * Publishable key tokens are returned in full - they are public by design and
 * ship inside every browser bundle. Secret keys are masked. Nothing is
 * written: every statement here is a SELECT.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const expected = process.env.DIAGNOSE_TOKEN

  if (!expected || req.query.token !== expected) {
    return res.status(404).json({ message: "Not found" })
  }

  const knex: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const rows = async (sql: string) => {
    try {
      const result = await knex.raw(sql)
      return result?.rows ?? result
    } catch (error: any) {
      return { query_failed: error?.message ?? String(error) }
    }
  }

  res.json({
    // Which database this process's pool actually landed in, as the server
    // reports it - not as the connection string claims.
    connection: await rows(
      `SELECT current_database() AS db, current_user AS usr,
              inet_server_addr()::text AS server_addr`
    ),
    api_keys: await rows(
      `SELECT id, type, title,
              CASE WHEN type = 'publishable' THEN token ELSE '[masked]' END AS token,
              revoked_at, deleted_at, created_at
         FROM api_key ORDER BY created_at`
    ),
    key_sales_channel_links: await rows(
      `SELECT publishable_key_id, sales_channel_id, deleted_at
         FROM publishable_api_key_sales_channel`
    ),
    sales_channels: await rows(
      `SELECT s.id, s.name, s.deleted_at, count(ps.product_id) AS products
         FROM sales_channel s
         LEFT JOIN product_sales_channel ps ON ps.sales_channel_id = s.id
        GROUP BY 1, 2, 3`
    ),
    catalogue: await rows(
      `SELECT (SELECT count(*) FROM design) AS designs,
              (SELECT count(*) FROM product) AS products,
              (SELECT count(*) FROM product_variant) AS variants,
              (SELECT count(*) FROM region) AS regions`
    ),
    /*
     * Which migration scripts this database believes it has run. If the seed
     * is absent here it is pending, and db:migrate runs it on every boot -
     * harmless while its guard sees designs, but worth knowing.
     */
    migration_scripts: await rows(
      `SELECT * FROM script_migrations ORDER BY id`
    ),
    process: {
      worker_mode: process.env.MEDUSA_WORKER_MODE ?? "(unset)",
      node_env: process.env.NODE_ENV ?? "(unset)",
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
    },
  })
}
