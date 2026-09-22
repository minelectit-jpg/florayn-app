import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260923090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_review" ("id" text not null, "review_key" text not null, "product_id" text not null, "customer_id" text not null, "author" text not null, "rating" integer not null check ("rating" between 1 and 5), "title" text not null, "body" text not null, "status" text check ("status" in ('pending','approved','rejected')) not null default 'pending', "reply" text not null default '', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_review_pkey" primary key ("id"));`)
    this.addSql(`create unique index if not exists "IDX_product_review_key_customer" on "product_review" ("review_key", "customer_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_product_review_key_status" on "product_review" ("review_key", "status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_product_review_deleted_at" on "product_review" ("deleted_at") where deleted_at is null;`)
  }
  override async down(): Promise<void> { this.addSql('drop table if exists "product_review" cascade;') }
}

