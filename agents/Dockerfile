# Build from the repo root with `docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile`.

FROM oven/bun:1.3.10 AS base
WORKDIR /build

FROM base AS build
COPY frontend/packages/shared ./frontend/packages/shared/
COPY frontend/packages/client ./frontend/packages/client/
COPY agents/package.json agents/bunfig.toml agents/bun.lock ./agents/
COPY agents/protocol ./agents/protocol/
RUN cd agents && bun install --frozen-lockfile --production
COPY agents/build.ts agents/tsconfig.json agents/bun-env.d.ts agents/components.json ./agents/
COPY agents/src ./agents/src/
RUN cd agents && bun run build

FROM oven/bun:1.3.10
WORKDIR /app
COPY --from=build /build/agents/package.json ./package.json
COPY --from=build /build/agents/dist/ .
VOLUME /data
ENV NODE_ENV=production
ENV SEED_AGENTS_DB_PATH=/data/agents.sqlite
ENV SEED_AGENTS_DATA_DIR=/data
EXPOSE 3050
CMD ["bun", "run", "--no-install", "main.js"]
