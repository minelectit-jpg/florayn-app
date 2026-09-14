# How we work on Florayn

This project has three places work can happen. This file says what belongs
where, so nothing lands in production unverified.

## The three surfaces

| Surface | Use it for | Never use it for |
| --- | --- | --- |
| **Claude Code (local session)** | All code changes. It has the repo, runs `medusa build` / `tsc` / unit tests, drives a local Postgres, reads the production Store API, converts images, uploads to R2. Code is built, typechecked, tested, and often run end-to-end **before** it is pushed. | — |
| **Medusa Admin** (browser, `/app`) | All data and settings: bundle tiers, home sections, menus, footer, collection pages, SEO templates, media, and every future feature's admin screen. | Code. |
| **GitHub connector** (chat / mobile) | Reading the repo, reviewing a diff, opening an **issue or PR** from a phone. | Pushing to `main` or triggering a deploy directly. |

## The one rule that keeps deploys green

**Code reaches `main` only after it builds, typechecks, and its tests pass locally.**

The reason is written in the git history: a type error only `medusa build`
catches, a `localhost` URL frozen into the bundle, a seed that rotated the
publishable key, 2,105 pages that saturated the backend, a bundle scope
enforced nowhere. Each would have shipped broken. Each was caught by running
the code locally first. A connector can write code but cannot run it, so:

- **Code originates in the local session**, where it is verified, then pushed.
- If a change is drafted elsewhere (connector, another assistant), it comes in
  as a **PR** and the local session verifies it before merge — it does not go
  straight to `main`.

## Why data/settings go to Admin, not code

Every feature carries its own admin screen, and its settings live in the
database, never in a constant (this is a standing project rule). So changing a
bundle discount, a menu label, or an SEO template is an **Admin** task, not a
code change — no deploy needed, and no risk to the build.

## Deploy

- Cloudways auto-deploys from `main`. **Both apps redeploy on every push.**
- A **backend** change (anything under `apps/backend`) needs the **backend**
  app redeployed; a **storefront** change needs the **storefront** app. A
  change touching both needs both.
- Secrets live only in `.env` files and the Cloudways dashboard — **never
  committed**. `apps/storefront/.env.production` holds only the two public
  `NEXT_PUBLIC_*` values (the publishable key and backend URL are public by
  design); nothing secret belongs there.
- `NEXT_PUBLIC_*` values are compiled into the storefront **at build time**, so
  changing one means a storefront **rebuild**, not just a restart.

## In one line

Code with the local session (verified, then pushed) · data and settings in
Medusa Admin · read and PR from the GitHub connector on mobile · never deploy
straight from the connector.
