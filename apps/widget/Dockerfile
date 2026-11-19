# Local demo image: the real widget bundle (luciel.js), built for a backend on this
# computer, served by nginx beside a small demo website (apps/widget/demo-site/).
# The backend repository's docker-compose.yml builds it as the `demo-site` service;
# production does not use this image (deploy.yml publishes the bundle to the embed CDN).
#
# Build context is the REPOSITORY ROOT so the pnpm workspace resolves:
#   docker build -f apps/widget/Dockerfile -t luciel-demo-site .
#   docker run --rm -p 8080:8080 luciel-demo-site     # then open http://localhost:8080
#
# The widget only runs on https pages or on http://localhost, so open the demo site at
# localhost (not 127.0.0.1).

# ---- Build the bundle -------------------------------------------------------
FROM node:22.23.5-trixie-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /repo
# Every workspace manifest, so the frozen lockfile matches; only the widget and the
# packages it uses are installed.
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/widget/package.json apps/widget/package.json
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --filter "@luciel/widget..."
COPY apps/widget ./apps/widget
# Public, non-secret values compiled into the bundle (vite.config.ts). The defaults are
# the local stack's: the real HTTP adapter against the API on http://localhost:8000.
ARG VITE_WIDGET_ADAPTER=http
ARG VITE_WIDGET_API_BASE_URL=http://localhost:8000
ENV VITE_WIDGET_ADAPTER=$VITE_WIDGET_ADAPTER
ENV VITE_WIDGET_API_BASE_URL=$VITE_WIDGET_API_BASE_URL
# `build` also runs scripts/check-bundle.mjs, the admin-surface release gate.
RUN pnpm --filter @luciel/widget build

# ---- Serve ------------------------------------------------------------------
# nginx as an unprivileged user, listening on 8080.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS runtime
COPY apps/widget/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/widget/demo-site/ /usr/share/nginx/html/
# The same path the embed CDN serves: /v1/luciel.js.
COPY --from=build /repo/apps/widget/dist/ /usr/share/nginx/html/v1/
EXPOSE 8080
