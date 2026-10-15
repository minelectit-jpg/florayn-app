# Florayn Console

Our own admin, in Florayn's look (the storefront's colours and Instrument
Sans), built for the phone as well as the desktop. It runs on the same Medusa
backend: **https://api.new.florayn.com/console** (after the cutover,
api.florayn.com/console). The classic Medusa admin at `/app` stays for
everything that has not moved yet and for rare settings.

Pages so far: Home, Mockup Studio (MOCKUP_STUDIO.md) and Models (add a model,
show/hide it in the store, badges; the classic Devices page cannot add one).
A new model is added hidden by default (`POST /admin/devices` with
`is_active: false`), so the menu never lists a model with nothing to buy.
Orders and products move in next, one page at a time.

## How it works

- Source: `apps/backend/console/` (React 18 + Vite, its own `tsconfig.json`,
  excluded from the backend's TypeScript build). No new dependencies: Vite and
  React are already in the backend's tree, and esbuild compiles the TSX.
- Build: `npm run build` in `apps/backend` runs `medusa build` and then
  `npm run build:console`, which writes `apps/backend/console-dist/` (ignored by
  git). The Dockerfile copies it to `/app/server/console-dist`.
- Serving: `src/api/console/route.ts` sends the page (`no-store`, `DENY`
  framing, `noindex`); `src/api/console/assets/[file]/route.ts` sends the hashed
  scripts and styles (cached for a year). Only plain file names inside
  `console-dist/assets` with a known type are served. Medusa routes take one
  path segment per parameter, so pages are addressed after the `#`
  (`/console#/mockup-studio`).
- Sign-in: the console uses the admin login (`/auth/user/emailpass`, then
  `/auth/session`), so it shares the cookie session with `/app` and calls the
  same `/admin/*` endpoints with exactly the same permissions. It is same-origin
  with the API, so no CORS settings are involved.
- Heavy work (mockup compositing) runs in Web Workers so the page stays
  responsive.

## Working on it

```bash
cd apps/backend
npm run typecheck:console
npm run build:console
npm run dev:console   # Vite on :5173, proxying /admin and /auth to a local backend on :9000
```

## Rules

1. The console is a front end only. Every read and write goes through the
   backend's `/admin/*` routes, which keep their validation and workflows. Never
   add a console-only shortcut around them.
2. A new page is one entry in `PAGES` in `console/src/main.tsx` plus its
   component under `console/src/pages/`. Settings still follow "every feature
   gets an admin screen": the screen can live here instead of in `/app`.
3. No secrets, keys or tokens in the console source or bundle.
4. Keep it light: the whole console is ~57 KB gzipped today.
