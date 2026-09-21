import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260921064114 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "contact_setting" ("id" text not null, "eyebrow" text not null default 'Contact', "title" text not null default 'Talk to us', "description" text not null default 'Questions about an order, a device we do not list yet, or an exchange - the fastest answer is a phone call.', "phone_label" text not null default 'Phone', "phone" text not null default '+8801310007055', "phone_note" text not null default 'Saturday to Thursday, 10am - 8pm', "email_label" text not null default 'Email', "email" text not null default 'info@florayn.com', "email_note" text not null default 'We reply within one working day', "address_label" text not null default 'Address', "address" text not null default 'Plot #H-2 (1st Floor), Block-H, Sector-2, Avenue-10
Zahurul Islam City (Aftabnagar Eastern Housing Project)
Dhaka-1212, Bangladesh', "address_note" text not null default '', "faq_eyebrow" text not null default 'FAQs', "faq_title" text not null default 'Common questions', "faq_description" text not null default 'A few helpful answers before you get in touch.', "help_title" text not null default 'Still have a question?', "help_description" text not null default 'Call or email us about your order, device compatibility or an exchange.', "faqs" jsonb not null default '[{"id":"delivery","question":"How long does delivery take?","answer":"Three to five days across Bangladesh. Delivery is 60৳ inside Dhaka and 100৳ outside, and free once your order reaches 3,400৳."},{"id":"exchanges","question":"Can I exchange a case?","answer":"Yes - within three days of delivery, as long as the case is unused and in its packaging. Message us first so we can arrange the pickup."},{"id":"payment","question":"How do I pay?","answer":"Cash on delivery. You pay the courier when the parcel reaches you."},{"id":"devices","question":"My device is not listed.","answer":"Tell us which model you have. Not every design is cut for every body, but we can say what is available and when a new one is coming."}]', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contact_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_contact_setting_deleted_at" ON "contact_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "contact_setting" cascade;`);
  }

}
