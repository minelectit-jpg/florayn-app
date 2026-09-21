import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260921190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "order_op" ("id" text not null, "order_id" text not null, "workflow_status" text not null default 'processing', "steadfast_consignment_id" text null, "steadfast_tracking_code" text null, "steadfast_status" text null, "steadfast_synced_at" timestamptz null, "label_printed_at" timestamptz null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_op_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_op_order_id_unique" ON "order_op" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_op_workflow_status" ON "order_op" ("workflow_status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_op_deleted_at" ON "order_op" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "courier_settings" ("id" text not null, "provider" text not null default 'steadfast', "api_key" text null, "secret_key" text null, "base_url" text not null default 'https://portal.packzy.com/api/v1', "enabled" boolean not null default false, "default_delivery_type" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "courier_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_courier_settings_deleted_at" ON "courier_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_op" cascade;`);
    this.addSql(`drop table if exists "courier_settings" cascade;`);
  }

}
