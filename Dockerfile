# syntax=docker/dockerfile:1.7

# Multi-stage build.
#
#   base       – shared OS layer with dumb-init for proper signal forwarding
#   prod-deps  – npm ci --omit=dev → minimal runtime dependency set
#                (postinstall hook runs `prisma generate` against the
#                copied schema, so the client lands in node_modules)
#   builder    – full deps + source → `npm run build`
#   runner     – slim final image: base + prod node_modules + build/ + prisma/

FROM node:22.12-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

FROM base AS prod-deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

FROM base AS builder
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 3000

# dumb-init reaps zombies and forwards SIGTERM so graceful shutdown
# actually reaches the Node process. The migrate step runs *inside*
# the entrypoint shell so a failed migration aborts startup.
ENTRYPOINT ["dumb-init", "--", "./entrypoint.sh"]
