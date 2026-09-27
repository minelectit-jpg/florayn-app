# Deploying Florayn to Cloudways

Written for someone who has not deployed a Node app before. Every command is
one you can copy and paste.

---

## The one thing that is not a setting

Florayn is **two separate servers**:

| | What it is | Serves |
| --- | --- | --- |
| **Backend** | Medusa | the API and the admin at `/app` |
| **Storefront** | Next.js | the shop customers see |

A Velocity app runs one build and one start command on one port, so it cannot
run both. You need **two apps** on the same repository and branch.

Your existing `florayn-app` becomes the **storefront**. Create the backend app
after this one is working.

## The setting that breaks the build

The two apps need **different Root Directories**, and this is not a preference:

- The **storefront** has its own `package-lock.json` and imports nothing
  outside its folder. Root Directory is `apps/storefront`.
- The **backend** is an npm workspace member with no lockfile of its own — its
  dependencies live in the repository root's `node_modules`. Root Directory
  must be the repository root, or `npm install` installs nothing.

**If your failed deploy had Root Directory empty or `/` for the storefront,
that is almost certainly why.** At the root, `npm run build` runs `turbo build`,
which builds the Medusa backend too, and the backend build needs a
`DATABASE_URL` the storefront app does not have. The build fails on a database
error while you are trying to deploy a website.

---

## Step 1 — the database

Provision PostgreSQL from the Cloudways dashboard. It is offered on every plan
alongside MySQL and MongoDB.

Then open **Overview** and find the database credentials section. Copy the host,
port, database name, user and password, and assemble them:

```
postgresql://USER:PASSWORD@HOST:PORT/DBNAME
```

If the credentials panel offers a ready-made connection string, use that
instead of assembling it. Add `?sslmode=require` on the end if Cloudways says
the database requires SSL.

That value is your `DATABASE_URL`. You will paste it into the backend app's
environment, and you may need it in your own terminal in Step 3.

## Step 2 — make your secrets

On your own computer, in the project folder, run this **twice** and keep both
results. They are two different random values.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Label them `JWT_SECRET` and `COOKIE_SECRET`. Do not reuse the development
values and do not put them in the repository — they go in the dashboard only.

## Step 3 — create the catalogue in the database

This has to happen once, before either app is useful. Which route you can use
depends on whether the database accepts connections from outside Cloudways.

**Find out first.** With your `DATABASE_URL` to hand, run this on your computer:

```bash
node -e "const{Client}=require('pg');const c=new Client(process.env.DATABASE_URL);c.connect().then(()=>{console.log('reachable');return c.end()}).catch(e=>console.log('not reachable:',e.message))"
```

Set `DATABASE_URL` in your shell first, or paste it into the string.

### Path 0 — restore a dump (do this one if you can)

Prefer this to seeding whenever the database is reachable. The seed is not a
bulk load: it drives 525 product creations and 13,041 variants through the
workflow engine one at a time, and it has to be watched on a host where you
cannot watch it. A restore is one bulk copy of a database you have already
tested, and it **carries the wired R2 image URLs with it**, so it also saves
running `wire-images-device.ts` afterwards.

The whole database compresses to under 5 MB.

`PGBIN` below is your local PostgreSQL `bin` directory — by default
`%USERPROFILE%\pgsql-root\pgsql\bin`.

1. Dump your local database:

```bash
"$PGBIN/pg_dump.exe" "$LOCAL_DATABASE_URL" -Fc -f florayn.dump
```

2. Restore it over the production one:

```bash
"$PGBIN/pg_restore.exe" --clean --if-exists --no-owner --no-privileges -d "$PROD_DATABASE_URL" florayn.dump
```

`--clean --if-exists` drops what is there first, which is what makes this
work on a database that is already half-populated. `--no-owner
--no-privileges` matter because the Cloudways database user is not the local
one, and without them the restore fails on every `OWNER TO` line.

**This replaces the whole database**, so afterwards:

- The publishable key becomes your **local** one. Set
  `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` on the storefront to that `pk_...`
  token — not the `apk_...` id, which is a different thing (see Step 6).
- Admin users are replaced by whatever your local database had. Set
  `ADMIN_EMAIL` and `ADMIN_PASSWORD` on the backend and restart to make yours
  again, then delete `ADMIN_PASSWORD`.
- The seed will now correctly skip on every future boot, because designs
  exist. That is the desired end state.

To read the token out of any database directly, rather than hunting for it in
the admin:

```bash
"$PGBIN/psql.exe" "$DATABASE_URL" -c "SELECT token FROM api_key WHERE type = 'publishable';"
```

### Path A — seed against production from your computer

1. Put the production `DATABASE_URL` in `apps/backend/.env`, replacing the
   local one.
2. Run:

```bash
cd apps/backend
npx medusa db:migrate
npx medusa user -e you@example.com -p "a password you choose"
npx medusa exec ./src/scripts/wire-images-device.ts
cd ..
npm run backend:key
```

3. Copy the `pk_...` the last command prints. You need it in Step 5.
4. **Put your local `DATABASE_URL` back**, or local work will write to
   production.

### Path B — the database is only reachable from Cloudways

Deploy the backend app first (Step 4), then use **Cron Job Management** to run
the setup once. Add a cron job, set it to run once at a time a few minutes
away, with this command:

```bash
cd /home/master/applications/YOUR_APP/public_html && npx medusa db:migrate && npx medusa exec ./src/scripts/wire-images-device.ts
```

Replace `YOUR_APP` with the path shown under **Access Details**. Delete the
cron job once it has run — the seed refuses to run twice, but the cron will
keep firing.

**The admin user needs no command at all.** Set these two on the backend app
and restart it from the PM2 panel:

```
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a password you choose
```

`start-backend.js` creates the account on the next boot, after migrations, and
says so in the log:

```
[start-backend] Admin user you@example.com created.
```

It is safe to leave set — every later restart prints `already exists; nothing
to do` instead. **Delete `ADMIN_PASSWORD` once the account exists**, though:
the CLI takes the password as a command-line argument, so it is briefly
visible to anything that can list processes on the host.

Reading the publishable key still needs a command run there:

```bash
cd /home/master/applications/YOUR_APP/public_html && npm run backend:key
```

Cron output goes to the job's log in the dashboard; that is where the `pk_...`
will appear.

## Step 4 — the storefront app (your existing florayn-app)

Set each field exactly as below.

| Field | Value |
| --- | --- |
| **Framework preset** | Next.js |
| **Branch** | `main` |
| **Node version** | 22 |
| **Root Directory** | `apps/storefront` |
| **Build and Output Settings** | Custom |
| — Install command | `npm install` |
| — Build command | `npm run build` |
| — Output directory | `.next` |
| — Start / run command | `npm run start` |

Because Root Directory is `apps/storefront`, every command runs inside that
folder. That is what makes them this short.

**Environment Variables** — use the Environment Variables tab:

```
NODE_ENV=production
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://your-backend-app.cloudwaysapps.com
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...
NEXT_PUBLIC_SITE_URL=https://your-storefront-app.cloudwaysapps.com
```

You will not have the backend URL or the `pk_` until Steps 3 and 5. Deploy once
with placeholders to prove the build works, then fill them in and redeploy —
the site will build either way, it just will not show products yet.

Do **not** set `PORT`. Cloudways sets it, and the start script now honours it.

Use the **PM2 Service** panel to Restart after changing environment variables;
a variable change alone does not restart the process.

## Step 5 — the backend app

Create a second app on the same repository and branch.

| Field | Value |
| --- | --- |
| **Framework preset** | Custom / Node.js — not Next.js |
| **Branch** | `main` |
| **Node version** | 22 |
| **Root Directory** | leave empty (the repository root) |
| **Build and Output Settings** | Custom |
| — Install command | `npm install` |
| — Build command | `npm --prefix apps/backend run build && npm --prefix apps/backend/.medusa/server install --omit=dev` |
| — Output directory | `apps/backend/.medusa/server` |
| **Entry File** | `start-backend.js` |

Two things about that row pair, both of which will break the app if changed.

**The Entry File is a file, not a command.** Cloudways runs it through PM2,
which expects a path to a JavaScript file. A shell command in that box does
not work. `start-backend.js` at the repository root is a small wrapper that
spawns the real server and forwards signals so PM2 can stop it cleanly.

**The build command installs twice on purpose.** `medusa build` produces a
self-contained app in `apps/backend/.medusa/server` with its own
`package.json` — and no `node_modules`. That second install fills them in.
Without it the app starts, prints `has no node_modules`, and exits 1.

**Environment Variables**, with the two URLs replaced by the real ones:

```
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
JWT_SECRET=<first value from Step 2>
COOKIE_SECRET=<second value from Step 2>
STORE_CORS=https://your-storefront-app.cloudwaysapps.com
ADMIN_CORS=https://your-backend-app.cloudwaysapps.com
AUTH_CORS=https://your-backend-app.cloudwaysapps.com,https://your-storefront-app.cloudwaysapps.com
MEDUSA_BACKEND_URL=https://your-backend-app.cloudwaysapps.com
IMAGE_BASE_URL=https://pub-1af88507922d437983ab3ffaf7336788.r2.dev
```

Deploy, then open `https://your-backend-app.cloudwaysapps.com/app` and log in.

## Step 6 — check it works

In this order, because each step rules out the one before:

1. `BACKEND_URL/health` returns `OK`
2. `BACKEND_URL/app` shows the admin login
3. `STOREFRONT_URL/` shows the home page
4. `STOREFRONT_URL/collection/leopard/` shows 44 products
5. `STOREFRONT_URL/product/amber-leopard-signature-iphone-12/` shows an
   iPhone 12 render
6. Add to cart and place a Cash on Delivery order
7. The order appears in the admin under Orders

**If the site loads but has no products**, it is one of three things, and
almost never anything else.

**The key is the id, not the token.** `apk_...` and `pk_...` are different
values on the same record: `apk_` is the row's id, which is what the admin
puts in the URL, and `pk_` is the token the storefront must send. Copying the
id out of the address bar gives you the wrong one, and the storefront renders
an empty grid rather than an error — so it looks like missing data. Read the
real token straight from the database:

```bash
"$PGBIN/psql.exe" "$DATABASE_URL" -c "SELECT token FROM api_key WHERE type = 'publishable';"
```

**`STORE_CORS` does not exactly match the storefront URL** — no trailing
slash, right protocol.

**The catalogue genuinely is not there.** Check with:

```bash
"$PGBIN/psql.exe" "$DATABASE_URL" -c "SELECT (SELECT count(*) FROM design) designs, (SELECT count(*) FROM product) products;"
```

Expect 181 and 525. Anything between 0 and those numbers means a seed was
interrupted, and the seed will not resume — its guard skips as soon as one
design exists. Restore a dump over it (Path 0); that is what `--clean` is for.

**On the admin key page 404ing** with `User with id: seed was not found`: that
was the seed storing a non-id string in `created_by`, which made the dashboard
look up a user that never existed. Fixed for new seeds. On a database seeded
before the fix:

```bash
"$PGBIN/psql.exe" "$DATABASE_URL" -c "UPDATE api_key SET created_by = '' WHERE created_by = 'seed';"
```

## Step 7 — staging

**Staging Management** gives you a copy of the app on its own URL. Worth using
before the domain is attached: push to `main`, let staging build, check Step 6
against the staging URL, then promote. It uses the same environment variables
unless you override them, so point staging at the same backend.

## Step 8 — connecting florayn.com, at the very end

1. **Domain Management** on the **storefront** app → add `florayn.com`.
2. **Domain Management** on the **backend** app → add `api.florayn.com`.
3. Update these and restart both from the PM2 panel:

```
# backend
STORE_CORS=https://florayn.com
ADMIN_CORS=https://api.florayn.com
AUTH_CORS=https://api.florayn.com,https://florayn.com
MEDUSA_BACKEND_URL=https://api.florayn.com

# storefront
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://api.florayn.com
NEXT_PUBLIC_SITE_URL=https://florayn.com
```

4. When `img.florayn.com` points at the R2 bucket, change `IMAGE_BASE_URL` on
   the backend and run the wiring once more. The image host is named in exactly
   one place, so that variable plus one command moves all 27,962 image URLs.

---

## If a deploy fails

Read the build log and look for the **first** error, not the last. The usual
causes, most likely first:

**"Cannot find module" or a database error during the storefront build** —
Root Directory is not `apps/storefront`. At the root the build runs `turbo
build`, which builds the backend, which needs a database.

**The build succeeds but the app is unreachable** — the start command is wrong,
or the process exited. Check the PM2 panel; if it is stopped or restarting in a
loop, the start command is the thing to fix.

**"medusa: not found" on the backend** — Root Directory is not empty. The
backend's dependencies are in the repository root.

**`[start-backend] ... has no node_modules`** — the build command is missing
its second half, the `npm --prefix apps/backend/.medusa/server install
--omit=dev`. The app is telling you exactly what to add.

**`[start-backend] No build found`** — the build did not reach
`apps/backend/.medusa/server` at all, so read the build log rather than this
one; the real failure is earlier.

**Out of memory during the storefront build** — it prerenders about 2,100
pages. Set `SEED_DEVICES_PER_PRODUCT=1` in the storefront environment to halve
that.

## Things worth knowing

**Redis.** `medusa-config.ts` wires Redis when `REDIS_URL` is set: the Redis
cache, event bus, workflow engine and locking modules replace Medusa's
in-memory defaults. Without it Medusa logs `redisUrl not found. A fake redis
instance will be used.`, which is fine for local development, and events are
lost on restart.

On the new-site server Redis runs with `maxmemory-policy allkeys-lru`, so under
memory pressure it may evict any key, including BullMQ job and repeat keys; it
was OOM-killed three times on 2026-09-19. The Redis event bus runs with
Medusa's default `attempts: 1`, so a failing subscriber is not retried. Nothing
that must survive (orders, ad tracking) may depend on a Redis key or on one
event delivery: durable state lives in Postgres, and the tracking jobs restart
themselves when their runs go stale (TRACKING.md invariant 2 and 6.4).

**Environment variables reach the backend two ways.** `start-backend.js`
prefers real environment variables and falls back to a `.env` at the
repository root or at `apps/backend/`, because the built server reads `.env`
relative to its own directory (`apps/backend/.medusa/server`) and would
otherwise ignore one placed at the app root. If a value is set on the app and
still is not arriving, the boot log says which of the two paths it used.

**The seed only runs once.** It refuses to run over a catalogue that already
exists. Reseeding means dropping the database, which also rotates the
publishable key and deletes the admin user, so Step 3 has to be redone whole.

**Both apps redeploy on a push to `main`.** Usually what you want; just expect
two builds.

---

## Ad tracking runbook (new.florayn.com on Coolify)

The new site runs on the DigitalOcean + Coolify server, not Cloudways, so this
section is written for Coolify and Cloudflare. It is the operator's copy of
TRACKING.md sections 16 and 19; the design and the reasons are there.

**The code is safe with none of this done.** Without `TRACKING_EDGE_SECRET`
and the Cloudflare header, tracking is inert: no tracking cookies, no events,
no pixels, no ad sends, and checkout works exactly as before. Every step
below needs the owner's OK. Never paste a secret or token in chat, in git or
in a ticket; secrets go only into Coolify, tokens only into Admin > Tracking.

Hard ordering rules:

- The two database migrations run **before** the backend deploy that reads
  them. If the backend lands first, orders and status changes still work, but
  each tracked checkout and each status change logs one warn line, the jobs
  record errors and `/store/tracking-config` answers 503 (the storefront
  falls back to all-off).
- `TRACKING_INGEST_SECRET` has the **same value** in both apps. A mismatch makes
  the backend refuse every ingest and checkout header (the
  `checkout_without_tracking` alert fires once a platform is on).
- Backend before storefront.
- The Cloudflare rate-limit rule on `/api/t/` (step 2, rule 4) is saved
  **before** the edge header rule (step 2, rule 2) switches tracking on, and
  stays while tracking is on.

### 1. Secrets (Coolify, both apps)

Make two values, each at least 32 characters, on your own computer:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Backend app: `TRACKING_INGEST_SECRET` = the first value.
  `TRACKING_INGEST_SECRET_PREVIOUS` only while rotating (the old value, removed
  after both apps run the new one). Never set `TRACKING_DRY_RUN` here.
- Storefront app: `TRACKING_INGEST_SECRET` = the same first value, and
  `TRACKING_EDGE_SECRET` = the second value.
- Both are runtime variables (leave "Build variable" unticked) and never
  `NEXT_PUBLIC_`. A variable reaches the container only on the next deploy.
  Through the Coolify API (4.3.x) that is `POST /applications/<uuid>/envs` with
  `is_buildtime: false, is_runtime: true` (Coolify adds a preview copy too).
- Rotating `TRACKING_INGEST_SECRET` invalidates the staff links and cookies:
  staff open the new links from Admin > Live afterwards.

### 2. Cloudflare rules for `new.florayn.com`

Every rule is scoped to the host (the rate limit to the `/api/t/` path, which
live `florayn.com` does not have), so live `florayn.com` is untouched.

1. **Cache bypass** (Caching > Cache Rules): when
   `(http.host eq "new.florayn.com" and starts_with(http.request.uri.path, "/api/t/"))`,
   Bypass cache. Put it last so it wins over the host-wide rules. (The
   endpoints already answer `private, no-store`, and the HTML rule excludes
   `/api/`; this rule keeps it that way if those rules change.)
2. **Edge header** (Rules > Transform Rules > Modify Request Header): when
   `(http.host eq "new.florayn.com")`, Set static `x-florayn-edge` to the
   storefront's `TRACKING_EDGE_SECRET`. "Set" replaces any value a visitor
   sends, so it cannot be forged through Cloudflare. Tracking switches on for
   that host as soon as this rule and the storefront secret match, so save
   rule 4 first.
3. **No bot challenge on `/api/t/`.** The calls are `fetch` and `sendBeacon`,
   which cannot solve a challenge. Bot Fight Mode on the free plan cannot be
   skipped per path; if it is on, check in QA that a normal browser's
   `/api/t/` calls return 200/204, not a challenge.
4. **Rate limit on `/api/t/` (required).** Security > WAF > Rate limiting
   rules > Create rule, before rule 2 switches tracking on:
   - Rule name: `Tracking endpoints`
   - If incoming requests match, Edit expression:
     `(starts_with(http.request.uri.path, "/api/t/"))`
   - With the same characteristics: IP
   - When rate exceeds: 60 requests, period 10 seconds
   - Then take action: Block, duration 10 seconds
   - Deploy

   The free plan allows only the path in a rate-limiting rule (not the host)
   and one such rule per zone; this is it. On Pro or higher, use rule 1's
   host-scoped expression instead. A real tab calls at most about once every
   2 seconds, so 60 per 10 seconds is a dozen busy tabs behind one address, and
   a blocked address loses only tracking for 10 seconds, never a page or
   checkout. The storefront's own limits (per visitor, per IPv4 address or
   IPv6 /64, and a fair share per source of the 3,000 events per 10 s forward
   cap) keep one source from crowding out real shoppers; this rule is what
   stops a request flood before it reaches the origin's CPU. Step 7 checks
   it.
5. Check that the existing click-id cache-key Transform Rule (it rewrites the
   origin query of document requests to keep only `case`) leaves the browser
   address intact: after opening
   `https://new.florayn.com/product/<handle>/?case=signature&fbclid=TEST`, the
   address bar still shows `fbclid`. The tracker reads the landing from there.

### 3. Origin firewall: not yet

Firewalling the origin's port 443 to Cloudflare's ranges is the planned last
layer, but `api.new.florayn.com` is DNS-only (grey cloud) and shares the same
origin port 443. A firewall today would cut off the API for browsers, the
storefront server and admin users. It needs `api.new.florayn.com` proxied
first (a two-level name the free Universal certificate does not cover), or
the backend moved to `api.florayn.com` at cutover, or an allowlist for the
server's own egress and admin users. Until then the edge header alone
protects ad sends: a request straight to the origin carries no valid
`x-florayn-edge`, so `/api/t/id/` sets no cookies and `/api/t/e/` forwards
nothing.

### 4. sharp and catalog images

`sharp@0.34.5` is already a backend dependency (committed with the root
lockfile) and the backend image installs it, so JPEG copies of catalog images
(`image_mode: "jpeg_copies"`, the default) need no further install. What is
left is the owner's choice in Admin > Tracking > Catalog: keep JPEG copies on
`img.florayn.com`, or switch to `cf_transform` after enabling Cloudflare Image
Transformations on the zone. The catalog stays off until the owner enables
it. Nothing to configure for the CPU: the conversion uses one sharp thread,
one image at a time, and stops each run at a time budget (by day 20 s of
conversion or 2 minutes in all, at night 2 and 10 minutes); the next run
carries on (TRACKING.md 8.3).

### 5. Migrations over the SSH tunnel, before the backend deploy

The in-container `medusa db:migrate` hangs on this host, so the scoped scripts
run from a local checkout of the same commit through a tunnel to the Postgres
container. Both scripts refuse any database except `florayn_v3` (and
disposable `florayn_*_test_*` ones), run only their one migration, and verify
on a second run.

```bash
# 1. Find the Postgres container's address on the Coolify network
ssh -i ~/.ssh/florayn_do root@<origin-ip> "docker ps --format '{{.Names}} {{.Image}}' | grep -i postgres"
ssh -i ~/.ssh/florayn_do root@<origin-ip> "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <postgres-container>"

# 2. Open the tunnel (leave it running in its own terminal)
ssh -i ~/.ssh/florayn_do -N -L 5433:<postgres-ip>:5432 root@<origin-ip>

# 3. In another terminal, from the repo root. Read the user and password from
#    the backend container (docker exec <backend-container> printenv DATABASE_URL);
#    never paste them anywhere else. Comment out REDIS_URL in apps/backend/.env
#    for this run if it is set: the scripts need only the database.
cd apps/backend
export DATABASE_URL="postgres://<user>:<password>@127.0.0.1:5433/florayn_v3"
npx medusa exec ./src/scripts/migrate-tracking.ts
npx medusa exec ./src/scripts/migrate-tracking.ts apply Migration20260928090000
npx medusa exec ./src/scripts/migrate-privacy-settings.ts
npx medusa exec ./src/scripts/migrate-privacy-settings.ts apply Migration20260928091000
unset DATABASE_URL
```

The first command of each pair is a read-only preflight; read its output
before applying. Run the apply again to see it verify without changes. In
PowerShell use `$env:DATABASE_URL = "..."` and `Remove-Item Env:DATABASE_URL`.

### 6. Deploy

1. Commit and push the branch Coolify builds (check the app's Git settings).
   Coolify builds the pushed commit, never local files. A push does not start
   a build by itself (2026-09-27): trigger each app with the Coolify API,
   `POST /api/v1/deploy?uuid=<app uuid>`, or its Deploy button.
2. Deploy the backend in Coolify and wait until it is healthy.
3. Deploy the storefront.
4. Purge and warm (the storefront speed rules): in Cloudflare, Caching >
   Configuration > Purge Cache > Custom purge by prefix `new.florayn.com/`
   paths for HTML (`/product/`, `/collection/`, `/collections/`, `/shop/`,
   `/contact/`, `/men`, plus the home URL), leaving `/_next/` alone; then
   request the main pages once with a browser user agent:

```bash
UA="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36"
for p in / /shop/ /men/ /checkout/; do
  curl -s -o /dev/null -A "$UA" -H "sec-fetch-dest: document" -w "%{http_code} %{time_total}s $p\n" "https://new.florayn.com$p"
done
```

Judge speed only after that, never cold.

### 7. Verify, with a browser user agent

`curl` without a browser user agent is treated as a bot (204, no cookies), so
always pass `-A "$UA"` from above.

```bash
# Through Cloudflare: 200, "Cache-Control: private, no-store", "on":true and Set-Cookie _fl_vid, _fl_sid, _fl_src
curl -sS -D - -A "$UA" -H "origin: https://new.florayn.com" -H "content-type: application/json" \
  -d '{"v":1,"landing":null}' https://new.florayn.com/api/t/id/

# Straight to the origin with a forged client IP: "on":false and no Set-Cookie
curl -sS -D - --resolve new.florayn.com:443:<origin-ip> -A "$UA" -H "origin: https://new.florayn.com" \
  -H "content-type: application/json" -H "cf-connecting-ip: 203.0.113.9" \
  -d '{"v":1,"landing":null}' https://new.florayn.com/api/t/id/

# Public tracking config: ids and modes only, never a token or an email
curl -sS -H "x-publishable-api-key: <pk_...>" https://api.new.florayn.com/store/tracking-config

# The private pages send no referrer: each prints "Referrer-Policy: no-referrer"
for p in /review/x/ /order/x/ /account/login/; do
  curl -sS -o /dev/null -D - -A "$UA" "https://new.florayn.com$p" | grep -i "^referrer-policy"
done

# Once a feed is published (Admin > Tracking > Catalog shows the URL): 200 with an ETag, then 304
curl -sS -o /dev/null -D - -A "$UA" "https://api.new.florayn.com/feeds/<feed token>/meta.tsv"
curl -sS -o /dev/null -D - -A "$UA" -H 'If-None-Match: "<etag from above>"' "https://api.new.florayn.com/feeds/<feed token>/meta.tsv"

# Last, the rate-limit rule: 300 calls, 10 at a time, from your address; some give 204 and the
# rest 429. Cloudflare's count lags, so the first ~100 of a burst can all pass (2026-09-27: 100
# calls gave 100 x 204; 300 gave 133 x 204 and 167 x 429). Your address then gets 429 on /api/t/
# for 10 seconds.
seq 1 300 | xargs -P 10 -I{} curl -s -o /dev/null -w "%{http_code}\n" -A "$UA" \
  -H "origin: https://new.florayn.com" -H "content-type: text/plain" \
  -d '{"v":1,"sent_at":1,"events":[]}' https://new.florayn.com/api/t/e/ | sort | uniq -c
```

No 429 at all means the rule is missing or not deployed: fix it before
turning a platform on.

Then in the admin: Tracking, Tracking > Health, Tracking > Catalog, Live and
Privacy all load, and Health shows fresh runs for the outbox, rollup,
reconcile and catalog jobs (the catalog job builds the variant index within
15 minutes even while the catalog is off). Until that first index build,
product events count as "unknown variant" and send nothing, so the
`unknown_variants` alert can fire once after a fresh deploy.

### 8. Backups

Ad-event tables are large and short-lived. Leave their data out of database
dumps:

```bash
pg_dump --exclude-table-data=tracking_hit --exclude-table-data=tracking_event -Fc -f florayn_v3.dump "$DATABASE_URL"
```

### 9. After deploy

The owner's admin steps (Meta TEST token, test event code, Automatic Advanced
Matching off and ticked, Meta on) and the QA plan on the TEST dataset are
TRACKING.md sections 15 and 17. Rollback lever: switch a platform off in
Admin > Tracking (it takes effect within 10 seconds; later events are kept as
`skipped`, and sending them later is an explicit Retry). Removing
`TRACKING_EDGE_SECRET` from the storefront makes tracking inert again.

Before TikTok is turned on, its Automatic advanced matching goes OFF in both
pixels too (with SPA page views and automatic events), then the one checkbox
in Admin > Tracking is ticked (TRACKING.md 17.C). Turning "Share hashed
contact details" ON affects only orders placed after it: an order's contact
details are hashed only if its shopper was shown the consent line.
