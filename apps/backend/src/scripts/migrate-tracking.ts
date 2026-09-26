import { join } from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import type { PostgreSqlSchemaHelper } from "@medusajs/framework/mikro-orm/postgresql"
import {
  ContainerRegistrationKeys, MedusaError, Modules,
  ModulesSdkUtils, mikroOrmCreateConnection,
} from "@medusajs/framework/utils"

const MIGRATION = "Migration20260928090000"
/** Every table of TRACKING.md section 2, created by that one migration. */
const TABLES = [
  "tracking_settings", "tracking_event", "tracking_cart_context", "tracking_order_context",
  "tracking_hit", "tracking_session", "tracking_minute", "tracking_day_dim", "tracking_state",
  "tracking_counter", "catalog_feed", "catalog_feed_fetch", "catalog_image", "tracking_variant",
]
const REQUIRED_INDEXES = [
  "IDX_tracking_settings_deleted_at", "tracking_event_key", "tracking_event_due", "tracking_event_sending",
  "tracking_event_created", "tracking_event_order", "tracking_cart_context_updated",
  "tracking_order_context_created", "tracking_hit_received", "tracking_session_day", "catalog_feed_fetch_at",
]

/**
 * Preflight: medusa exec ./src/scripts/migrate-tracking.ts
 * Apply: medusa exec ./src/scripts/migrate-tracking.ts apply Migration20260928090000
 *
 * Applies the tracking module's one hand-written migration out-of-band, BEFORE
 * the backend deploy that reads the tables (a copy of migrate-contact-settings).
 * Uses Medusa's migrator with that one explicit migration. It never runs the
 * seed, other module migrations or a schema generator, and reads no data rows.
 * A second apply finds it recorded and only verifies the schema.
 */
export default async function migrateTracking({ container, args = [] }: ExecArgs) {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const databaseUrl = config.projectConfig.databaseUrl
  if (!databaseUrl) throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "Missing application database configuration")
  const database = new URL(databaseUrl)
  if (database.pathname !== "/florayn_v3" && !/^\/florayn_(?:checkout|contact|tracking)_test_[a-z0-9_]+$/.test(database.pathname)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This migration is restricted to the new-site Medusa database or a disposable test database")
  }
  const apply = args.length === 2 && args[0] === "apply" && args[1] === MIGRATION
  if (args.length && !apply) throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT,
    `Use no arguments for preflight, or exactly: apply ${MIGRATION}`)

  // Match the initialized application's actual SSL configuration. Medusa's
  // migration loader otherwise assumes SSL for a private Docker hostname.
  const initializedConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const ssl = initializedConnection?.client?.config?.connection?.ssl
  const configuredDriverOptions = config.projectConfig.databaseDriverOptions ?? {}
  const db = ModulesSdkUtils.loadDatabaseConfig("tracking", { database: {
    clientUrl: databaseUrl,
    schema: config.projectConfig.databaseSchema ?? "public",
    driverOptions: { ...configuredDriverOptions,
      ...(ssl !== undefined ? { ssl, connection: { ...configuredDriverOptions.connection, ssl } } : {}),
    },
    // Medusa's CustomDBMigrator issues SET LOCAL through a second connection
    // while MikroORM holds its migration transaction open. One slot deadlocks.
    pool: { min: 0, max: 2 },
  } }, true)
  const migrationsPath = join(__dirname, "../modules/tracking/migrations")
  const connect = () => mikroOrmCreateConnection({ ...db, snapshot: false }, [], migrationsPath)

  async function inspect() {
    const orm = await connect()
    try {
      const connection = orm.em.getConnection()
      const helper = orm.em.getDriver().getPlatform().getSchemaHelper() as PostgreSqlSchemaHelper
      const schema = db.schema || "public"
      // Introspection is restricted to these literal table names; no rows are read.
      const definitions = [{ table_name: "mikro_orm_migrations", schema_name: schema },
        ...TABLES.map((table_name) => ({ table_name, schema_name: schema }))]
      // PostgreSQL's legacy getColumns/getIndexes wrappers incorrectly index
      // the result by bare table name. The supported bulk methods use the
      // schema-qualified key and still receive only these literal tables.
      const columnMap = await helper.getAllColumns(connection, new Map([[schema, definitions]]))
      const historyColumns = columnMap[`${schema}.mikro_orm_migrations`] ?? []
      const executed = historyColumns.length ? await orm.getMigrator().getExecutedMigrations() : []
      const names = executed.map((entry) => entry.name.replace(/\.[jt]s$/, ""))
      const existing = definitions.slice(1).filter((definition) => (columnMap[`${schema}.${definition.table_name}`] ?? []).length > 0)
      const indexMap = existing.length ? await helper.getAllIndexes(connection, existing) : {}
      const tables = TABLES.map((table) => {
        const columns = columnMap[`${schema}.${table}`] ?? []
        return { table, exists: columns.length > 0, columns: columns.length,
          indexes: (indexMap[`${schema}.${table}`] ?? []).map((index) => index.keyName) }
      })
      const configColumn = (columnMap[`${schema}.tracking_settings`] ?? []).find((column) => column.name === "config")
      return { migration: MIGRATION, recorded: names.includes(MIGRATION),
        history_exists: historyColumns.length > 0,
        tables,
        settings_config_type: configColumn?.type ?? null,
      }
    } finally { await orm.close(true) }
  }

  const before = await inspect()
  logger.info(`TRACKING_MIGRATION_PREFLIGHT ${JSON.stringify(before)}`)
  if (!apply) return
  await container.resolve(Modules.LOCKING).execute(`florayn-migration:${MIGRATION}`, async () => {
    const current = await inspect()
    if (!current.recorded) {
      const orm = await connect()
      try {
        // This is the same MikroORM API used by Medusa's internal
        // Migrations.run wrapper, which Medusa 2.19 does not publicly export.
        await orm.getMigrator().up({ migrations: [MIGRATION] })
      } finally { await orm.close(true) }
    }
    const after = await inspect()
    const missingTables = after.tables.filter((table) => !table.exists).map((table) => table.table)
    const indexes = after.tables.flatMap((table) => table.indexes)
    const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.includes(name))
    if (!after.recorded || missingTables.length || missingIndexes.length || after.settings_config_type !== "jsonb") {
      throw new MedusaError(MedusaError.Types.DB_ERROR,
        `Tracking migration schema verification failed (tables: ${missingTables.join(", ") || "ok"}; indexes: ${missingIndexes.join(", ") || "ok"})`)
    }
    logger.info(`TRACKING_MIGRATION_VERIFIED ${JSON.stringify(after)}`)
  }, { timeout: 120 })
}
