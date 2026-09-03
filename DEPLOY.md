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

This has to happen once, before either app is useful. There are two ways, and
which one you can use depends on whether the database accepts connections from
outside Cloudways.

**Find out first.** With your `DATABASE_URL` to hand, run this on your computer:

```bash
node -e "const{Client}=require('pg');const c=new Client(process.env.DATABASE_URL);c.connect().then(()=>{console.log('reachable');return c.end()}).catch(e=>console.log('not reachable:',e.message))"
```

Set `DATABASE_URL` in your shell first, or paste it into the string.

### Path A — the database is reachable from your computer

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

Creating the admin user and reading the publishable key also need a command
run there. Add them the same way, one at a time:

```bash
cd /home/master/applications/YOUR_APP/public_html/apps/backend && npx medusa user -e you@example.com -p "a password you choose"
```

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

**If the site loads but has no products**, it is one of two things, and almost
never anything else: the publishable key is wrong, or `STORE_CORS` does not
exactly match the storefront URL — no trailing slash, right protocol.

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

**Redis.** Medusa uses an in-memory event bus without it and says so in the
logs — `redisUrl not found. A fake redis instance will be used.` On one server
that works; events are lost on restart.

Setting `REDIS_URL` on the app **will not** stop that message. Nothing reads
it: `medusa-config.ts` configures no Redis at all. Wiring it up is a code
change to that file, not an environment variable, and it is still outstanding.

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
