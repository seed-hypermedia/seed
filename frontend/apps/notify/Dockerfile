# Build from the root with `docker build -t seedhypermedia/notify:dev . -f ./frontend/apps/notify/Dockerfile`.
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 -v $PWD/notify-data:/data --rm --name seed-notify seedhypermedia/notify:dev
#
# Notify runs on Bun as a single bundle (`build/main.js`, every dependency inlined; SQLite is
# bun:sqlite), so the runtime image holds nothing but that file. CI builds the bundle ahead of time
# and passes PREBUILT=true; otherwise the builder stage installs the workspace and bundles it.

FROM node:22-bookworm-slim AS builder

ARG PREBUILT=false

COPY --from=oven/bun:1.3.10 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
# Pin pnpm to the version declared in package.json's `packageManager` (same source
# pnpm/action-setup uses in CI). An unpinned `npm install -g pnpm` pulls the latest major,
# which can refuse to install against an older lockfile (ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE).
RUN if [ "$PREBUILT" != "true" ]; then \
      npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" && \
      pnpm install --frozen-lockfile --filter "@shm/notify..." && \
      pnpm --filter @shm/notify build; \
    fi
RUN test -f frontend/apps/notify/build/main.js

FROM oven/bun:1.3.10 AS production

ARG COMMIT_HASH
ARG BRANCH
ARG DATE
ARG NOTIFY_SENTRY_DSN

WORKDIR /app
COPY --from=builder /app/frontend/apps/notify/build/ ./build/

RUN echo "$COMMIT_HASH" > /app/COMMIT_HASH && echo "$BRANCH" > /app/BRANCH && echo "$DATE" > /app/DATE

# Same uid as the previous Node image, so existing /data volumes stay writable.
RUN useradd --system --uid 1001 --no-create-home seed-notify && mkdir -p /data && chown seed-notify /data
USER seed-notify

EXPOSE 3000
VOLUME /data

ENV NODE_ENV=production
ENV PORT=3000
ENV COMMIT_HASH=${COMMIT_HASH}
ENV NOTIFY_SENTRY_DSN=${NOTIFY_SENTRY_DSN}
ENV NOTIFY_SENTRY_RELEASE=${COMMIT_HASH}
ENV NOTIFY_SENTRY_ENVIRONMENT=production

CMD ["bun", "run", "--no-install", "build/main.js"]
