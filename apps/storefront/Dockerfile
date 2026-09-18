# Next.js storefront image. Build context is apps/storefront (it is standalone,
# with its own package-lock.json and no imports outside its folder).
#
#   docker build -f apps/storefront/Dockerfile apps/storefront
#
# Debian slim (glibc), not alpine, for the same native-module reliability as the
# backend (Next's SWC compiler and sharp).

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .

# NEXT_PUBLIC_* are compiled into the bundle at build time. They come from the
# committed .env.production (both values are public), which Next loads
# automatically during the build. Update that file and rebuild to change them.
RUN npm run build

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/.next ./.next
# No ./public folder in this storefront (all assets come from R2 / .next), so
# it is intentionally not copied - the COPY would fail on a missing path.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
# The custom Redis incremental-cache handler referenced by next.config.ts.
# next start resolves it at /app/cache-handler.js (import.meta.dirname).
COPY --from=build /app/cache-handler.js ./cache-handler.js

EXPOSE 3000
CMD ["npm", "run", "start"]
