import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Read back the one-shot wiring log.
 *
 * Cron stdout does not surface on this host, so a cron that refuses to start
 * is indistinguishable from one that never ran - which cost a full round trip
 * once already. The wrapper appends to one of these files; this hands the tail
 * back through the browser.
 */
function readWireLog(): { file: string; tail: string[] } | { file: null } {
  /*
   * The web process runs with cwd = apps/backend/.medusa/server, so the
   * application root - where the cron writes - is four levels up, not three.
   * The extra candidates cost nothing and cover a differently-rooted deploy.
   */
  const candidates = [
    path.join(process.cwd(), "..", "..", "..", "..", "wire-oneshot.log"),
    path.join(process.cwd(), "..", "..", "..", "wire-oneshot.log"),
    path.join(process.cwd(), "..", "..", "wire-oneshot.log"),
    path.join(process.cwd(), "wire-oneshot.log"),
    path.join(os.tmpdir(), "wire-oneshot.log"),
  ]
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)
      return { file, tail: lines.slice(-60) }
    } catch {
      // unreadable is the same as absent for this purpose
    }
  }
  return { file: null }
}

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
    /*
     * How far the image wiring has got, straight from this process's own pool.
     * Counting placeholders rather than trusting a cron's exit code is the
     * only measure that cannot be wrong about it.
     */
    image_wiring: await rows(
      `SELECT count(*) FILTER (WHERE thumbnail LIKE 'http%')  AS wired,
              count(*) FILTER (WHERE thumbnail LIKE 'data:%') AS placeholder,
              count(*) FILTER (WHERE thumbnail IS NULL)       AS null_thumb,
              (SELECT count(*) FROM product_variant WHERE metadata ? 'images')
                AS variants_with_images
         FROM product`
    ),
    /*
     * Whether the web process can even see the variables a cron would need.
     * Names and presence only - never the values, since one is a connection
     * string with a password in it.
     */
    wiring_env_visible_to_web: {
      WIRE_DATABASE_URL: Boolean(process.env.WIRE_DATABASE_URL),
      IMAGE_BASE_URL: process.env.IMAGE_BASE_URL ?? "(unset)",
      WIRE_LIMIT: process.env.WIRE_LIMIT ?? "(unset)",
      DIAGNOSE_TOKEN: Boolean(process.env.DIAGNOSE_TOKEN),
    },
    wire_log: readWireLog(),
    process: {
      worker_mode: process.env.MEDUSA_WORKER_MODE ?? "(unset)",
      node_env: process.env.NODE_ENV ?? "(unset)",
      cwd: process.cwd(),
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
    },
  })
}
