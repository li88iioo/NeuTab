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

RUN corepack enable

# Install workspace deps (copy package manifests first for better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/patch-plasmo-templates.mjs scripts/patch-plasmo-templates.mjs
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY webserver/package.json webserver/package.json
COPY webserver/client/package.json webserver/client/package.json
COPY webserver/server/package.json webserver/server/package.json

RUN pnpm install --no-frozen-lockfile

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
# Stage 2: Production deps - Clean install for server only (Alpine)
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /deps

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

# Copy package.json and package-lock.json for reproducible installs
COPY webserver/server/package.json webserver/server/package-lock.json ./
RUN npm ci --omit=dev

# =============================================================================
# Stage 3: Runtime - Minimal Alpine image
# =============================================================================
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
ENV CLIENT_DIST_DIR=/app/client/dist

WORKDIR /app

# Copy production dependencies (clean, server-only)
COPY --from=deps /deps/node_modules ./server/node_modules

# Copy server build output
COPY --from=builder /app/webserver/server/dist ./server/dist
COPY --from=builder /app/webserver/server/package.json ./server/package.json

# Copy client static files
COPY --from=builder /app/webserver/client/dist ./client/dist

# Create data directories
RUN mkdir -p /app/data/icons

EXPOSE 3001

WORKDIR /app/server

CMD ["node", "dist/index.js"]
