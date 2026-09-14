# Medusa backend image. Build context is the REPOSITORY ROOT, because the
# backend is an npm workspace member and its dependencies resolve from the
# root node_modules.
#
#   docker build -f apps/backend/Dockerfile .
#
# Debian slim (glibc), not alpine: @swc/core (which transpiles medusa-config.ts
# at build) and sharp ship reliable glibc prebuilts; the musl variants on alpine
# fail to load and the config loader then reports "Cannot find module
# medusa-config".

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install workspace deps first, for layer caching. The root lockfile covers the
# backend workspace; only apps/backend's package.json is needed alongside it.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
# --include=dev so build tooling is present even if NODE_ENV leaks in as production.
RUN npm ci --include=dev

# Build the self-contained server bundle, then install its production deps.
COPY . .
RUN cd apps/backend && npm run build
RUN cd apps/backend/.medusa/server && npm install --omit=dev

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/server

# The compiled, self-contained app.
COPY --from=build /app/apps/backend/.medusa/server ./
# The device image manifest lives in apps/backend/data and is NOT copied into
# .medusa/server by `medusa build`, so bring it in explicitly and point the
# wiring script at it.
COPY --from=build /app/apps/backend/data ./data
ENV IMAGE_MANIFEST_DEVICE=/app/server/data/images-device-manifest.json

EXPOSE 9000

# Run pending migrations (which also runs the seed migration script) then boot.
# The seed is idempotent and skips once designs exist; SEED_THEME narrows the
# first seed to one collection.
CMD ["sh", "-c", "npx medusa db:migrate && npm run start"]
