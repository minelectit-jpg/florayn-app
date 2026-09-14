# Next.js storefront image. Build context is apps/storefront (it is standalone,
# with its own package-lock.json and no imports outside its folder).
#
#   docker build -f apps/storefront/Dockerfile apps/storefront

FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* are compiled into the bundle at build time. Coolify passes them
# as build args; they override the committed .env.production fallback. Always
# set both in Coolify, or the build bakes the wrong (or empty) values.
ARG NEXT_PUBLIC_MEDUSA_BACKEND_URL
ARG NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_MEDUSA_BACKEND_URL=${NEXT_PUBLIC_MEDUSA_BACKEND_URL}
ENV NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY}
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
