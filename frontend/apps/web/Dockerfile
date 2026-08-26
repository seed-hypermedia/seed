# Build from the root with `docker build -t seedhypermedia/web:dev . -f ./frontend/apps/web/Dockerfile`.
# Push to the server with `docker save seedhypermedia/web:dev | ssh -C <user>@<server_IP> docker load`
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-web seed-web:latest

FROM node:20-alpine AS builder

ARG PREBUILT=false
ARG SENTRY_AUTH_TOKEN
ARG SITE_SENTRY_DSN
ARG COMMIT_HASH
ARG BRANCH
ARG DATE

ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SITE_SENTRY_DSN=${SITE_SENTRY_DSN}
ENV SENTRY_RELEASE=${COMMIT_HASH}
ENV SITE_SENTRY_RELEASE=${COMMIT_HASH}
ENV SITE_SENTRY_ENVIRONMENT=production

RUN apk add --no-cache git python3 make g++
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
# Pin pnpm to the version declared in package.json's `packageManager` (same source
# pnpm/action-setup uses in CI). An unpinned `npm install -g pnpm` pulls the latest major,
# which can refuse to install against an older lockfile (ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE).
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"


RUN rm -rf ./frontend/apps/desktop
RUN rm -rf ./frontend/apps/performance
RUN rm -rf ./frontend/apps/perf-web
RUN rm -rf ./frontend/apps/performance-dashboard
RUN rm -rf ./frontend/apps/explore
RUN pnpm install --frozen-lockfile
RUN if [ "$PREBUILT" != "true" ]; then NODE_OPTIONS="--max-old-space-size=4096" pnpm web:prod; fi

FROM node:20-alpine AS production

ARG COMMIT_HASH
ARG BRANCH
ARG DATE

COPY --from=builder /app/frontend/apps/web /app/frontend/apps/web
# COPY --from=builder /app/frontend/apps/web/node_modules /app/frontend/apps/web/node_modules
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
# Copy workspace packages that are symlinked in node_modules
COPY --from=builder /app/frontend/packages /app/frontend/packages

RUN echo "$COMMIT_HASH" > /app/frontend/apps/web/COMMIT_HASH
RUN echo "$BRANCH" > /app/frontend/apps/web/BRANCH
RUN echo "$DATE" > /app/frontend/apps/web/DATE
RUN echo "1" > /app/frontend/apps/web/IS_BUILD

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 seed-web
USER seed-web

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app/frontend/apps/web


CMD ["npm", "run", "start:prod"]