# The hosted kurisu: one build, two images (server and web). Built by deploy/compose.yaml.
# The whole workspace stays in each image: the server imports @kurisu/shared as TypeScript
# source, which Node 24 runs directly from the workspace (not from node_modules).
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Dependencies first, so a code change doesn't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
# Next bakes the /api rewrite into the build, so the server's address is fixed here.
ARG API_INTERNAL_URL=http://server:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm build

FROM build AS server
ENV NODE_ENV=production
WORKDIR /app/apps/server
USER node
EXPOSE 4000
# Pending migrations first; then the server. exec, so Docker's stop signal reaches Node.
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/server.js"]

FROM build AS web
ENV NODE_ENV=production
WORKDIR /app/apps/web
# next start caches optimized cover art under .next/cache.
RUN chown -R node:node .next
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
