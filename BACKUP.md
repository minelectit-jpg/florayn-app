# Backups

Florayn's own backups: the database every hour, the backend settings once a
day, both encrypted with the owner's key and collected into the owner's Google
Drive by a script that runs inside the owner's Google account. Built so that
losing the DigitalOcean account or a hacked server does not lose the shop.

## What is kept, and where

| What | How often | Where |
|---|---|---|
| Database `florayn_v3` (orders, customers, products, settings, reviews, tracking settings) | every hour at :07 | Google Drive folder "Florayn Backups" |
| Backend settings (all backend environment variables: database URL, secrets, API keys) | once a day | same folder |
| Product images and media | already in Cloudflare R2, a different company from DigitalOcean | R2 (copy them to a USB drive now and then) |
| Code | every push | GitHub, and the owner's computer |

Left out on purpose: the data of `tracking_hit` and `tracking_event` (large,
short-lived ad-event rows; the tables themselves are kept, empty).

Drive keeps every hourly copy for 48 hours, then the newest of each day for 30
days and of each month for a year; the rest goes to Drive's trash (30 more
days). The server keeps only the newest few files (Admin > Backups,
"keep_local", default 6).

## How it works, and why it is safe

1. The `backup-hourly` job (`src/jobs/backup.ts`) runs `pg_dump` 17 (installed
   in the backend image from the PostgreSQL apt repository), checks that the
   dump reads back (`pg_restore --list`: at least 30 tables, with orders and
   products), and encrypts it with the owner's **public** age key
   (https://age-encryption.org). The unencrypted dump is deleted at once.
2. The Google Apps Script (Admin > Backups shows it, filled in) runs hourly in
   the owner's Google account. It **pulls** the encrypted files from
   `/backup-pull/*` with a bearer token, checks each file's SHA-256, saves it
   to Drive and acknowledges it.
3. The server never holds a Google credential, so a hacked server cannot touch
   Drive. The pull token only lets someone download files that are encrypted.
4. Only the owner's **private** key opens the files. It is made in the
   browser on Admin > Backups and downloaded as `florayn-backup-PRIVATE-key.txt`.
   The server never sees it. Keep it on a USB stick **and** printed. Without it
   nobody can open the backups, including us.

Emails (to the Admin > Backups alert email, else the Tracking alert email):
a backup failed (again every 6 hours while failing), backups work again, and
Google Drive has collected nothing for 4 hours (again every 12 hours).

## Setting it up (once)

1. **Admin > Backups > Create encryption key.** Save the downloaded private key
   file on a USB stick, print it, tick the box, press Save key.
2. **Turn on** hourly backups. Check the alert email.
3. Press **Back up now** and check that the history shows "OK".
4. **Google Drive:** open https://script.google.com with the Google account
   that has the storage, make a new project "Florayn backups", paste the script
   from Admin > Backups (Copy script), save.
5. **Create Drive token** on Admin > Backups and copy it (it is shown once). In
   the script: Project Settings (gear) > Script Properties > add
   `FLORAYN_BACKUP_TOKEN` = the token.
6. In the script editor choose `setup` and press Run; allow Drive and external
   requests. "Florayn Backups" appears in Drive, and the history on Admin >
   Backups shows the time it was collected.
7. Once a month: Admin > Backups > Download the newest database file to a USB
   stick, so one copy is outside Google too.

After the cutover the API address changes (api.florayn.com): copy the script
again from Admin > Backups (it shows the current address) or edit `SERVER` at
the top of the script.

Limits: Apps Script downloads at most 50 MB per file. The encrypted dump is
about 20 MB today; if it grows past 45 MB, split the download first.

## Restore (the server or the DigitalOcean account is gone)

You need: the private key file, the newest `florayn-db-*.dump.age` and
`florayn-env-*.json.age` from Drive (or the USB copy), and a new server.

1. **Open the files** on your computer, from the repository root (after
   `npm install`):

   ```bash
   node apps/backend/scripts/backup-decrypt.mjs florayn-backup-PRIVATE-key.txt florayn-db-20261010T0707Z.dump.age florayn.dump
   node apps/backend/scripts/backup-decrypt.mjs florayn-backup-PRIVATE-key.txt florayn-env-20261010.json.age backend-env.json
   ```

   The official `age` tool does the same:
   `age --decrypt -i florayn-backup-PRIVATE-key.txt -o florayn.dump florayn-db-....dump.age`.
   `backend-env.json` holds every backend environment variable; treat it as a
   password file and delete it when done.
2. **New server:** a DigitalOcean (or any) droplet with Coolify, as in
   DEPLOY.md. Create a PostgreSQL 17 database `florayn_v3` with user `medusa`.
3. **Load the database** (from a machine that reaches it):

   ```bash
   docker run --rm -v "$PWD:/b" -e PGPASSWORD='<new db password>' postgres:17 \
     pg_restore -h <db host> -U medusa -d florayn_v3 --no-owner --no-privileges /b/florayn.dump
   ```
4. **Apps:** create the backend and storefront apps from GitHub (DEPLOY.md).
   Set the backend variables from `backend-env.json`, with `DATABASE_URL`
   pointing at the new database and `REDIS_URL` at the new Redis. The
   storefront needs its publishable key, backend URL, `REVALIDATE_SECRET` and
   the tracking secrets (DEPLOY.md, Ad tracking runbook).
5. **DNS:** in Cloudflare, point the site and API records at the new server;
   purge and warm (DEPLOY.md).
6. Images need nothing: they are served from Cloudflare R2.
7. Check an order, Admin > Orders, Admin > Backups (turn backups back on: the
   settings came back with the database) and Admin > Tracking > Health.

## Restore drill

Every few months, restore the newest backup into a throwaway database (steps 1
and 3 against a local `postgres:17` container) and check that the order count
matches Admin > Orders. A backup that has never been opened is not a backup.
