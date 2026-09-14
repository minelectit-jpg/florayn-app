import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

/*
 * Redis, wired only when REDIS_URL is set.
 *
 * Without it Medusa falls back to an in-memory event bus, cache and workflow
 * engine - fine for local development, but on one server those lose state on
 * restart and cannot be shared, which is why the logs warn about it in
 * production. In production REDIS_URL is set, so the three Redis-backed modules
 * take over. Local dev without a Redis keeps the in-memory defaults by leaving
 * this array empty.
 */
const redisUrl = process.env.REDIS_URL
const redisModules = redisUrl
  ? [
      {
        resolve: "@medusajs/cache-redis",
        options: { redisUrl },
      },
      {
        resolve: "@medusajs/event-bus-redis",
        options: { redisUrl },
      },
      {
        resolve: "@medusajs/workflow-engine-redis",
        options: { redis: { url: redisUrl } },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    ...redisModules,
    {
      resolve: "./src/modules/catalog",
    },
    {
      resolve: "./src/modules/bundles",
    },
    {
      resolve: "./src/modules/content",
    },
  ],
})
