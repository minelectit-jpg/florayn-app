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
        resolve: "@medusajs/medusa/cache-redis",
        options: { redisUrl },
      },
      {
        resolve: "@medusajs/medusa/event-bus-redis",
        options: { redisUrl },
      },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        options: { redis: { url: redisUrl } },
      },
      {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [{
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl },
          }],
        },
      },
    ]
  : []

/*
 * File storage. With R2 credentials set, uploads (product images, design
 * mockups, videos) go to the Cloudflare R2 bucket and are served from its public
 * URL - keeping media off the small droplet disk. Without them, Medusa's default
 * local provider is used (fine for local dev). acl:false is required: R2 has no
 * per-object ACLs and rejects the ACL header the S3 provider would otherwise send.
 */
const fileModule =
  process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? [
        {
          resolve: "@medusajs/file",
          options: {
            providers: [
              {
                // NOTE: @medusajs/file-s3 reads SNAKE_CASE option keys
                // (access_key_id, secret_access_key, file_url) - camelCase is
                // silently ignored and the provider throws "access key required".
                resolve: "@medusajs/file-s3",
                id: "s3",
                options: {
                  file_url: process.env.R2_PUBLIC_URL,
                  access_key_id: process.env.R2_ACCESS_KEY_ID,
                  secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
                  region: "auto",
                  bucket: process.env.R2_BUCKET,
                  endpoint: process.env.R2_ENDPOINT,
                  acl: false,
                },
              },
            ],
          },
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
    ...fileModule,
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
