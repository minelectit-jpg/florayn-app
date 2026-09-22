import { join } from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import type { PostgreSqlSchemaHelper } from "@medusajs/framework/mikro-orm/postgresql"
import {
  ContainerRegistrationKeys, MedusaError, Modules,
  ModulesSdkUtils, mikroOrmCreateConnection,
} from "@medusajs/framework/utils"

const MIGRATION = "Migration20260923090000"
const TABLE = "product_review"
const REQUIRED_COLUMNS = ["id", "review_key", "product_id", "customer_id", "author", "rating", "title", "body", "status", "reply", "created_at", "updated_at", "deleted_at"]

/**
 * Preflight: medusa exec ./src/scripts/migrate-product-reviews.ts
 * Apply: medusa exec ./src/scripts/migrate-product-reviews.ts apply Migration20260923090000
 *
 * Uses Medusa's migrator with one explicit migration. It never runs the seed,
 * previous content migrations, other module migrations or a schema generator.
 */
export default async function migrateProductReviews({ container, args = [] }: ExecArgs) {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const databaseUrl = config.projectConfig.databaseUrl
  if (!databaseUrl) throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "Missing application database configuration")
  const database = new URL(databaseUrl)
  if (database.pathname !== "/florayn_v3" && !/^\/florayn_(?:contact|checkout)_test_[a-z0-9_]+$/.test(database.pathname)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This migration is restricted to the new-site Medusa database or a disposable contact test database")
  }
  const apply = args.length === 2 && args[0] === "apply" && args[1] === MIGRATION
  if (args.length && !apply) throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT,
    `Use no arguments for preflight, or exactly: apply ${MIGRATION}`)

  // Match the initialized application's actual SSL configuration. Medusa's
  // migration loader otherwise assumes SSL for a private Docker hostname.
  const initializedConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const ssl = initializedConnection?.client?.config?.connection?.ssl
  const configuredDriverOptions = config.projectConfig.databaseDriverOptions ?? {}
  const db = ModulesSdkUtils.loadDatabaseConfig("content", { database: {
    clientUrl: databaseUrl,
    schema: config.projectConfig.databaseSchema ?? "public",
    driverOptions: { ...configuredDriverOptions,
      ...(ssl !== undefined ? { ssl, connection: { ...configuredDriverOptions.connection, ssl } } : {}),
    },
    // Medusa's CustomDBMigrator issues SET LOCAL through a second connection
    // while MikroORM holds its migration transaction open. One slot deadlocks.
    pool: { min: 0, max: 2 },
  } }, true)
  const migrationsPath = join(__dirname, "../modules/content/migrations")
  const connect = () => mikroOrmCreateConnection({ ...db, snapshot: false }, [], migrationsPath)

  async function inspect() {
    const orm = await connect()
    try {
      const connection = orm.em.getConnection()
      const helper = orm.em.getDriver().getPlatform().getSchemaHelper() as PostgreSqlSchemaHelper
      const schema = db.schema || "public"
      // Both introspection calls are restricted to literal known table names.
      // No customer/order/content data rows are queried.
      const definitions = [
        { table_name: "mikro_orm_migrations", schema_name: schema },
        { table_name: TABLE, schema_name: schema },
      ]
      // PostgreSQL's legacy getColumns/getIndexes wrappers incorrectly index
      // the result by bare table name. The supported bulk methods use the
      // schema-qualified key and still receive only these two literal tables.
      const columnMap = await helper.getAllColumns(connection, new Map([[schema, definitions]]))
      const historyColumns = columnMap[`${schema}.mikro_orm_migrations`] ?? []
      const executed = historyColumns.length ? await orm.getMigrator().getExecutedMigrations() : []
      const names = executed.map((entry) => entry.name.replace(/\.[jt]s$/, ""))
      const columns = columnMap[`${schema}.${TABLE}`] ?? []
      const indexMap = columns.length ? await helper.getAllIndexes(connection, [definitions[1]]) : {}
      const indexes = indexMap[`${schema}.${TABLE}`] ?? []
      return { migration: MIGRATION, recorded: names.includes(MIGRATION),
        history_exists: historyColumns.length > 0,
        recorded_content_migrations: names.filter((name) => [
          "Migration20260902132846", "Migration20260902170738", "Migration20260903084818",
          "Migration20260917120000", "Migration20260917160000", "Migration20260917190000",
          "Migration20260917210000", "Migration20260920194733", MIGRATION,
        ].includes(name)),
        table_exists: columns.length > 0,
        columns: columns.map((column) => ({ name: column.name, type: column.type, nullable: column.nullable })),
        indexes: indexes.map((index) => index.keyName),
      }
    } finally { await orm.close(true) }
  }

  const before = await inspect()
  logger.info(`PRODUCT_REVIEWS_MIGRATION_PREFLIGHT ${JSON.stringify(before)}`)
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
    const missing = REQUIRED_COLUMNS.filter((name) => !after.columns.some((column) => column.name === name))
    if (!after.recorded || missing.length || !after.indexes.includes("IDX_product_review_deleted_at") ||
      !after.indexes.includes("IDX_product_review_key_customer") || !after.indexes.includes("IDX_product_review_key_status")) {
      throw new MedusaError(MedusaError.Types.DB_ERROR, "Product review migration schema verification failed")
    }
    logger.info(`PRODUCT_REVIEWS_MIGRATION_VERIFIED ${JSON.stringify(after)}`)
  }, { timeout: 120 })
}

