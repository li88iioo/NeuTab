# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Builder - Build everything
# =============================================================================
FROM node:20-bookworm-slim AS builder

ENV CI=true
ENV PNPM_DISABLE_SELF_UPDATE_CHECK=1

WORKDIR /app

# better-sqlite3 needs build tools for native compilation
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Install workspace deps (copy package manifests first for better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/patch-plasmo-templates.mjs scripts/patch-plasmo-templates.mjs
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY webserver/package.json webserver/package.json
COPY webserver/client/package.json webserver/client/package.json
COPY webserver/server/package.json webserver/server/package.json

RUN pnpm install --frozen-lockfile

# Copy sources
COPY packages ./packages
COPY scripts ./scripts
COPY webserver ./webserver

# Build shared packages first
RUN pnpm --filter @neutab/shared build
RUN pnpm --filter @neutab/ui build

# Build web client (static files) + server
RUN pnpm --filter neutab-web-client build
RUN pnpm --filter neutab-web-server build

# =============================================================================
# Stage 2: Production deps - Install server-only production deps with pnpm
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /deps

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/webserver/server/package.json ./webserver/server/package.json

WORKDIR /deps/webserver/server
RUN pnpm install --prod --ignore-workspace --frozen-lockfile --lockfile-dir /deps

# =============================================================================
# Stage 3: Runtime - Minimal Alpine image
# =============================================================================
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
ENV CLIENT_DIST_DIR=/app/client/dist

WORKDIR /app

# Create non-root user for runtime
RUN addgroup -S neutab && adduser -S neutab -G neutab

COPY --from=deps /deps/node_modules ./node_modules
COPY --from=deps /deps/webserver/server/node_modules ./webserver/server/node_modules

# Copy server build output
COPY --from=builder /app/webserver/server/dist ./webserver/server/dist
COPY --from=builder /app/webserver/server/package.json ./webserver/server/package.json

# Copy client static files
COPY --from=builder /app/webserver/client/dist ./client/dist

# Create data directories and set ownership
RUN mkdir -p /app/data/icons && chown -R neutab:neutab /app/data

EXPOSE 3001

USER neutab

WORKDIR /app/webserver/server

CMD ["node", "dist/index.js"]
