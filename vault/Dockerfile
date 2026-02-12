FROM oven/bun:1 AS builder
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /build/dist/ .
COPY --from=builder /build/node_modules ./node_modules
VOLUME /data
CMD ["bun", "main.js"]
