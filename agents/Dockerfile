# Build from the repo root with `docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile`.

FROM oven/bun:1.3.10 AS base
WORKDIR /build

FROM base AS build
COPY frontend/packages/shared ./frontend/packages/shared/
COPY frontend/packages/client ./frontend/packages/client/
COPY agents/package.json agents/bunfig.toml agents/bun.lock ./agents/
COPY agents/protocol ./agents/protocol/
RUN cd agents && bun install --frozen-lockfile --production
# The bundle keeps `microsandbox` external (napi binding + `msb` + libkrunfw cannot live inside
# bundled JS), so its package is staged as real directories for the final image — right after
# install, so the layer caches on the lockfile.
COPY agents/scripts/stage-msb-runtime.ts ./agents/scripts/
RUN cd agents && bun scripts/stage-msb-runtime.ts /staged
COPY agents/build.ts agents/tsconfig.json agents/bun-env.d.ts ./agents/
COPY agents/src ./agents/src/
RUN cd agents && bun run build

FROM oven/bun:1.3.10
# The slim bun image ships no system CA store, and the msb hypervisor helper (Rust) verifies
# registry TLS against it — without this the first sandbox rootfs pull dies with
# "No CA certificates were loaded from the system".
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/agents/package.json ./package.json
COPY --from=build /staged/node_modules/ ./node_modules/
COPY --from=build /build/agents/dist/ .
# Prove the staged runtime actually loads through the same path execute uses, so a packaging
# regression fails the image build instead of surfacing as codeExec:false on the servers.
RUN bun run --no-install main.js --exec-selfcheck

# Version metadata, surfaced at /api/version and /api/health. Declared after the
# COPY so changing them only rebuilds this trailing layer, not the app build.
# COMMIT_HASH/BRANCH/DATE match the web and daemon image build args; VERSION is the
# image tag. They are mapped to namespaced SEED_AGENTS_* runtime env.
ARG VERSION=dev
ARG COMMIT_HASH=unknown
ARG BRANCH=unknown
ARG DATE=unknown
ENV SEED_AGENTS_VERSION=${VERSION} \
    SEED_AGENTS_COMMIT=${COMMIT_HASH} \
    SEED_AGENTS_BRANCH=${BRANCH} \
    SEED_AGENTS_DATE=${DATE}

VOLUME /data
ENV NODE_ENV=production
ENV SEED_AGENTS_DB_PATH=/data/agents.sqlite
ENV SEED_AGENTS_DATA_DIR=/data
EXPOSE 3050
CMD ["bun", "run", "--no-install", "main.js"]
