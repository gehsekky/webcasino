FROM node:22.12-alpine
WORKDIR /app

# Copy manifests + Prisma schema before `npm ci` so the postinstall
# hook (prisma generate) can resolve schema.prisma. Keeping these
# layers separate from the rest of the source preserves cache hits
# when only application code changes.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Bring in the rest of the source and build.
COPY . .
RUN npm run build

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
