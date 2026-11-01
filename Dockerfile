# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# One-off migration + user seed runner (Compose `migrate` service). Has full node_modules.
FROM deps AS migrator
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY samples ./samples
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/seed.mjs"]

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:worker

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# The worker is bundled separately (standalone output only traces the Next server).
# Same image, different command: `node worker.mjs` (Compose `worker` service).
COPY --from=build --chown=node:node /app/dist/worker.mjs ./worker.mjs
USER node
EXPOSE 3000
CMD ["node", "server.js"]
