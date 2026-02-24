# Build from the repo root with `docker build -t seedhypermedia/vault:dev . -f ./vault/Dockerfile`.

FROM oven/bun:1.3.9 AS base
WORKDIR /build

FROM base AS build
WORKDIR /build
COPY frontend/packages/shared/package.json ./frontend/packages/shared/
COPY vault/package.json vault/bunfig.toml vault/bun.lock ./vault/
RUN cd vault && bun install --frozen-lockfile --production
COPY frontend/packages/shared ./frontend/packages/shared/
COPY vault ./vault/
RUN cd vault && bun run build

FROM oven/bun:1.3.9
WORKDIR /app
COPY --from=build /build/vault/dist/ .
VOLUME /data
ENV SEED_VAULT_DB_PATH=/data/vault.sqlite
EXPOSE 3000
CMD ["bun", "run", "--no-install", "main.js"]
