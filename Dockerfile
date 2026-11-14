# Production image: the Next.js standalone server plus what the entrypoint
# needs to migrate and seed the database on start. Debian slim (glibc), not
# Alpine, so Prisma uses its standard debian-openssl-3.0.x engines.
#
#   docker compose up --build        # db + app, see docker-compose.yml
#
# Stages: deps (npm ci) -> builder (next build); prisma-cli (only the Prisma
# CLI, for `migrate deploy`); runner (the image that runs).

ARG NODE_IMAGE=node:24-bookworm-slim

# --- deps: every dependency from the lockfile --------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `postinstall` runs `prisma generate`, which needs the schema.
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# --- builder: next build with standalone output ------------------------------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT_STANDALONE=1
COPY . .
RUN npm run build

# --- prisma-cli: the Prisma CLI alone, at the lockfile's version -------------
FROM ${NODE_IMAGE} AS prisma-cli
WORKDIR /opt/prisma-cli
# openssl here too, so the install fetches the same engine the runner detects.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package-lock.json /tmp/package-lock.json
RUN version="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
  && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund --omit=dev "prisma@${version}" \
  && npm cache clean --force

# --- runner -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  CHECKPOINT_DISABLE=1 \
  PRISMA_CLI=/opt/prisma-cli/node_modules/prisma/build/index.js

COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
# server.js and the traced node_modules (incl. @prisma/client and its query
# engine), then the static assets and public files it serves.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migrations and the seed. The seed runs on Node's built-in TypeScript support
# and imports `#lib/builtin-categories` through the `imports` map in
# package.json.
COPY package.json ./package.json
COPY prisma ./prisma
COPY lib/builtin-categories.ts ./lib/builtin-categories.ts
COPY docker/entrypoint.mjs ./docker/entrypoint.mjs

# Root owns the files (read-only to the app); the server runs as `node` and may
# write only its runtime cache.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --start-period=60s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/signin').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "docker/entrypoint.mjs"]
