# Production image for apps/web (Next.js SSR — `force-dynamic` + middleware).
# Build context is the REPOSITORY ROOT so the pnpm workspace resolves correctly:
#   docker build -f apps/web/Dockerfile -t luciel-web .
#
# Multi-stage: deps -> build -> runtime. Non-root, no baked secrets.
# NEXT_PUBLIC_* values are inlined at build time; pass only NON-secret public
# values via --build-arg if you need to override the in-code defaults.

# ---- Base -------------------------------------------------------------------
# Node 22 LTS on bookworm-slim. We apply OS security upgrades at build time so the
# image doesn't ship stale base CVEs (ECR scan-on-push blocks CRITICAL per §5.14;
# the prior node:20.18 base failed on perl + gnutls28 criticals). Node 20 is also
# being deprecated, so 22 LTS is the forward-looking base.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /repo

# ---- Dependencies (cached on lockfile) --------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/widget/package.json apps/widget/package.json
COPY packages/ packages/
RUN pnpm install --frozen-lockfile

# ---- Build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json tsconfig.base.json ./
COPY apps/web ./apps/web
# Re-link workspace bins for apps/web (node_modules already populated by deps).
RUN pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @luciel/web build

# ---- Runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Run as the unprivileged, pre-existing `node` user.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/.npmrc ./
COPY --from=build --chown=node:node /repo/apps/web ./apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /repo/apps/web
CMD ["pnpm", "start"]
