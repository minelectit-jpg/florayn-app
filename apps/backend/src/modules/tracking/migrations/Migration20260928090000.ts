import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Ad tracking, live dashboard and catalog feed tables (TRACKING.md section 2).
 *
 * Hand-written on purpose: only tracking_settings is a DML model. Every other
 * table is a raw table reached through lib/tracking/* with the PG_CONNECTION
 * knex, because it needs ON CONFLICT, FOR UPDATE SKIP LOCKED and counter
 * upserts that module services cannot express. Never regenerate this with
 * `medusa db:generate tracking`.
 *
 * Additive and idempotent, so it is applied out-of-band with
 * scripts/migrate-tracking.ts BEFORE the backend deploy that reads it, and a
 * second run changes nothing.
 */
export class Migration20260928090000 extends Migration {
  override async up(): Promise<void> {
    // 2.1 settings singleton (DML columns, like order-ops' settings rows).
    this.addSql(`create table if not exists "tracking_settings" ("id" text not null, "config" jsonb not null default '{}', "meta_test_token" text null, "meta_live_token" text null, "tiktok_test_token" text null, "tiktok_live_token" text null, "catalog_feed_token" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tracking_settings_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_tracking_settings_deleted_at" on "tracking_settings" ("deleted_at") where deleted_at is null;`)

    // 2.2 outbox: one row per platform copy of an event, sent by the outbox job.
    this.addSql(`create table if not exists tracking_event (
  id bigserial primary key,
  platform text not null,
  env text not null,
  destination text not null,
  event_name text not null,
  event_id text not null,
  event_time timestamptz not null,
  source text not null,
  order_id text null,
  payload jsonb null,
  status text not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz null,
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
) with (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);`)
    this.addSql(`create unique index if not exists tracking_event_key on tracking_event (platform, event_name, event_id);`)
    this.addSql(`create index if not exists tracking_event_due on tracking_event (next_attempt_at) where status in ('pending','retry');`)
    this.addSql(`create index if not exists tracking_event_sending on tracking_event (locked_until) where status = 'sending';`)
    this.addSql(`create index if not exists tracking_event_created on tracking_event (created_at);`)
    this.addSql(`create index if not exists tracking_event_order on tracking_event (order_id) where order_id is not null;`)

    // 2.3 checkout contexts: never in cart or order metadata (public Store API).
    this.addSql(`create table if not exists tracking_cart_context (
  cart_id text primary key, context jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());`)
    this.addSql(`create index if not exists tracking_cart_context_updated on tracking_cart_context (updated_at);`)
    this.addSql(`create table if not exists tracking_order_context (
  order_id text primary key, display_id int not null, cart_id text null,
  host text not null, env text null,
  context jsonb not null,
  trusted boolean not null default false,
  staff boolean not null default false, optout boolean not null default false,
  purchase_time timestamptz not null, created_at timestamptz not null default now());`)
    this.addSql(`create index if not exists tracking_order_context_created on tracking_order_context (created_at);`)

    // 2.4 dashboard: raw hits (7 days), sessions, rollups, job state, counters.
    this.addSql(`create table if not exists tracking_hit (
  event_name text not null, event_id text not null,
  origin char(1) not null,
  received_at timestamptz not null default clock_timestamp(),
  visitor_id text null, session_id text null, source text null, campaign varchar(80) null,
  device_class text null, audience text null, host text not null, path varchar(300) null,
  handle text null, variant_id text null, device text null, case_type text null,
  value numeric null, items int null, country char(2) null,
  flags int not null default 0,
  primary key (event_name, event_id))
  with (autovacuum_vacuum_scale_factor = 0.02);`)
    this.addSql(`create index if not exists tracking_hit_received on tracking_hit (received_at);`)
    this.addSql(`create table if not exists tracking_session (
  session_id text primary key, visitor_id text not null, day date not null,
  started_at timestamptz not null, last_at timestamptz not null, source text null, campaign varchar(80) null,
  landing_path varchar(300) null, device_class text null, audience text null, host text not null,
  is_new_visitor boolean not null default false, pageviews int not null default 0,
  flags int not null default 0,
  purchase_value numeric not null default 0);`)
    this.addSql(`create index if not exists tracking_session_day on tracking_session (day);`)
    this.addSql(`create table if not exists tracking_minute (
  bucket timestamptz not null, event_name text not null, source text not null default '', host text not null,
  count int not null, value numeric not null default 0,
  primary key (bucket, event_name, source, host));`)
    this.addSql(`create table if not exists tracking_day_dim (
  day date not null, dim text not null, key text not null, event_name text not null, host text not null,
  count int not null, value numeric not null default 0,
  primary key (day, dim, key, event_name, host));`)
    this.addSql(`create table if not exists tracking_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());`)
    this.addSql(`create table if not exists tracking_counter (
  hour timestamptz not null, key text not null, n bigint not null default 0,
  primary key (hour, key));`)

    // 2.5 catalog feed, image copies and the variant index.
    this.addSql(`create table if not exists catalog_feed (
  platform text not null, kind text not null,
  body_gzip bytea not null, etag text not null, content_hash text not null, item_count int not null,
  built_at timestamptz not null, published_at timestamptz null,
  status text not null, warnings jsonb not null default '[]',
  primary key (platform, kind));`)
    this.addSql(`create table if not exists catalog_feed_fetch (
  id bigserial primary key, platform text not null, fetched_at timestamptz not null default now(),
  user_agent varchar(200) null, status int not null, bytes int not null);`)
    this.addSql(`create index if not exists catalog_feed_fetch_at on catalog_feed_fetch (fetched_at);`)
    this.addSql(`create table if not exists catalog_image (
  source_url text primary key, jpg_url text null, bytes int null, error text null,
  created_at timestamptz not null default now());`)
    this.addSql(`create table if not exists tracking_variant (
  variant_id text primary key, product_id text not null, handle text not null, sku text null,
  case_type text null, device text null, price numeric null,
  in_stock boolean not null default false, sellable boolean not null default false,
  updated_at timestamptz not null default now());`)
  }

  override async down(): Promise<void> {
    for (const table of [
      "tracking_variant", "catalog_image", "catalog_feed_fetch", "catalog_feed",
      "tracking_counter", "tracking_state", "tracking_day_dim", "tracking_minute",
      "tracking_session", "tracking_hit", "tracking_order_context", "tracking_cart_context",
      "tracking_event", "tracking_settings",
    ]) {
      this.addSql(`drop table if exists "${table}" cascade;`)
    }
  }
}
