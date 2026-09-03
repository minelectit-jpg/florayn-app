# Deploying Florayn to Cloudways

Written for someone who has not deployed a Node app before. Every command is
one you can copy and paste.

**Read the two findings first.** They change what you need to buy, and no
amount of dashboard clicking gets around them.

---

## Finding 1 — this needs two apps, not one

Florayn is two separate servers:

| | What it is | Command | Serves |
| --- | --- | --- | --- |
| **Backend** | Medusa | `medusa start` | the API and the admin at `/app` |
| **Storefront** | Next.js | `next start` | the shop customers see |

A Velocity app runs **one** build and **one** start command on **one** port. It
cannot run both. So you need **two Velocity apps**, both pointing at
`github.com/minelectit-jpg/florayn-app`, branch `main`, with different settings.

Your existing `florayn-app` becomes the **storefront**. Create a second app for
the backend.

> If Velocity turns out not to let you set a custom start command or a
> subdirectory, the backend will not run there. In that case put the backend on
> a normal Cloudways server with the Node.js stack, and keep Velocity for the
> storefront only. The storefront is the part that benefits from Velocity.

## Finding 2 — Cloudways does not give you PostgreSQL

Medusa **requires** PostgreSQL. It does not run on MySQL or MariaDB, which is
what Cloudways servers provide. Velocity does not ship a database at all.

So the database has to come from somewhere else. Any managed Postgres works.
Cheapest sensible options:

- **Neon** (neon.tech) — has a free tier, made for this
- **Supabase** (supabase.com) — free tier, gives you a Postgres URL
- **DigitalOcean Managed Database** — paid, same company style as Cloudways

Pick one, create a Postgres database, and copy the connection string it gives
you. It looks like:

```
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

That string is your `DATABASE_URL`. Keep it somewhere safe; you will paste it
into both the deploy settings and your own terminal.

**Check before you buy:** log into Cloudways and look for a Database or Add-ons
section on the Velocity app. If PostgreSQL is offered there now, use it and
skip the external provider. It was not offered when this was written.

---

## Step 1 — make your secrets

On your own computer, in the project folder, run this **three times** and keep
each result. They are three different random values.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Label them:

1. `JWT_SECRET`
2. `COOKIE_SECRET`
3. spare (keep it; you will want one later)

**Do not reuse the development values, and do not put these in the repository.**
They go in the Cloudways dashboard only.

## Step 2 — set up the database

1. Create the Postgres database at Neon or Supabase.
2. Copy the connection string.
3. On your computer, put it in `apps/backend/.env` **temporarily**, replacing
   the local one:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

4. Create the tables and the catalogue:

```bash
cd apps/backend
npx medusa db:migrate
```

That runs the migrations **and** the seed, because the seed is a migration
script. It creates 181 designs, 6 case types, 50 devices, 525 products and
13,041 variants. It takes a few minutes.

5. Create your admin login:

```bash
npx medusa user -e you@example.com -p "a password you choose"
```

6. Read the publishable key the seed made — you need it in Step 4:

```bash
cd ..
npm run backend:key
```

Copy the `pk_...` value.

7. Point the product images at R2:

```bash
cd apps/backend && npx medusa exec ./src/scripts/wire-images-device.ts
```

8. **Put your local `DATABASE_URL` back** to the development one, or local work
   will start writing to production.

> Running the seed from your own machine against the remote database is
> deliberate. Velocity may not give you a terminal on the server, and this
> avoids needing one.

## Step 3 — the backend app

Create a second Velocity app on the same repository and branch.

**Build settings**

| Field | Value |
| --- | --- |
| Node version | 22 |
| Install command | `npm install` |
| Build command | `npm --prefix apps/backend run build` |
| Start command | `cd apps/backend/.medusa/server && npm install --omit=dev && npm run start` |
| Output / root directory | leave as the repository root |

That start command looks odd and is not optional. `medusa build` produces a
self-contained app in `apps/backend/.medusa/server` with its own
`package.json`; that folder is what actually runs.

**Environment variables**

Replace `BACKEND_URL` and `STOREFRONT_URL` with the URLs Cloudways gives each
app once created. They look like `https://something.cloudwaysapps.com`.

```
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
JWT_SECRET=<the first value from Step 1>
COOKIE_SECRET=<the second value from Step 1>
STORE_CORS=STOREFRONT_URL
ADMIN_CORS=BACKEND_URL
AUTH_CORS=BACKEND_URL,STOREFRONT_URL
MEDUSA_BACKEND_URL=BACKEND_URL
IMAGE_BASE_URL=https://pub-1af88507922d437983ab3ffaf7336788.r2.dev
DISABLE_MEDUSA_ADMIN=false
```

Deploy. When it is up, open `BACKEND_URL/app` and log in with the user from
Step 2. If you see the admin, the backend is working.

## Step 4 — the storefront app

Use your existing `florayn-app`.

**Build settings**

| Field | Value |
| --- | --- |
| Node version | 22 |
| Install command | `npm run setup` |
| Build command | `npm run storefront:build` |
| Start command | `npm --prefix apps/storefront run start` |
| Output / root directory | leave as the repository root |

`npm run setup` installs both the root and the storefront, which has its own
`node_modules` on purpose — the storefront is deliberately not an npm workspace
member, because Medusa's admin needs React 18 and Next needs React 19.

**Environment variables**

```
NODE_ENV=production
NEXT_PUBLIC_MEDUSA_BACKEND_URL=BACKEND_URL
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<the pk_... from Step 2>
NEXT_PUBLIC_SITE_URL=STOREFRONT_URL
```

`NEXT_PUBLIC_SITE_URL` is what the sitemap and robots.txt put in their URLs.
Set it to the Cloudways URL for now and change it to `https://florayn.com` when
you connect the domain.

Deploy. Open `STOREFRONT_URL`. You should see the home page with real product
images.

## Step 5 — check it works

In this order:

1. `BACKEND_URL/health` returns `OK`
2. `BACKEND_URL/app` shows the admin login
3. `STOREFRONT_URL/` shows the home page
4. `STOREFRONT_URL/collection/leopard/` shows 44 products
5. `STOREFRONT_URL/product/amber-leopard-signature-iphone-12/` shows an
   iPhone 12 render
6. Add something to the cart and place a Cash on Delivery order
7. The order appears in the admin under Orders

If the storefront loads but has no products, the publishable key is wrong or
`STORE_CORS` does not exactly match the storefront URL. Those two cause almost
every "it deployed but it is empty" problem.

## Step 6 — connecting florayn.com, at the very end

When you are ready:

1. Attach the domain to the **storefront** app in Cloudways.
2. Attach a subdomain — `api.florayn.com` — to the **backend** app.
3. Update these and redeploy both:

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

4. Point `img.florayn.com` at the R2 bucket, then change `IMAGE_BASE_URL` on
   the backend and run once from your computer, against the production
   database:

```bash
cd apps/backend && npx medusa exec ./src/scripts/wire-images-device.ts
```

The image host is named in exactly one place, so that variable plus that one
command moves every image URL.

---

## Things that will bite

**Redis.** Medusa uses an in-memory event bus without it and says so in the
logs. On one server that works, but events are lost on restart and it will not
survive scaling to two. Add Redis when you can; Medusa reads `REDIS_URL`.

**The seed only runs once.** It refuses to run over a catalogue that already
exists. To reseed you must drop and recreate the database, which also rotates
the publishable key and deletes the admin user — so Step 2 has to be redone in
full.

**Build memory.** The storefront prerenders a seed of about 2,100 pages. If the
build is killed, lower it by setting `SEED_DEVICES_PER_PRODUCT=1` on the
storefront app, which cuts the seed to roughly 1,050 pages.

**Two apps, one repository.** Both apps redeploy on a push to `main`. That is
usually what you want; just expect both to rebuild.
