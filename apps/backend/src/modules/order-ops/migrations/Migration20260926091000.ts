import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Review requests over WhatsApp: the Meta Cloud API connection, and which
 * channel each request went out on. Additive and idempotent, so it can run
 * ahead of the deploy that reads it.
 */
export class Migration20260926091000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "whatsapp_settings" ("id" text not null, "enabled" boolean not null default false, "phone_number_id" text null, "business_account_id" text null, "access_token" text null, "api_version" text not null default 'v23.0', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "whatsapp_settings_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_whatsapp_settings_deleted_at" on "whatsapp_settings" ("deleted_at") where deleted_at is null;`)
    this.addSql(`alter table if exists "order_op" add column if not exists "review_request_channel" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_op" drop column if exists "review_request_channel";`)
    this.addSql(`drop table if exists "whatsapp_settings" cascade;`)
  }
}
