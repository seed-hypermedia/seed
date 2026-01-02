# Build from the root with `docker build -t seedhypermedia/notify:dev . -f ./frontend/apps/notify/Dockerfile`.
# Push to the server with `docker save seedhypermedia/notify:dev | ssh -C <user>@<server_IP> docker load`
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-notify seed-notify:latest

FROM node:20-alpine AS builder

RUN apk add git
RUN npm install -g pnpm@9.15.0
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .


ENV NODE_ENV production
RUN rm -rf ./frontend/apps/desktop
RUN rm -rf ./frontend/apps/performance
RUN rm -rf ./frontend/apps/perf-web
RUN rm -rf ./frontend/apps/performance-dashboard
RUN rm -rf ./frontend/apps/explore
RUN rm -rf ./frontend/apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm notify:build

FROM node:20-alpine AS production

ARG COMMIT_HASH
ARG BRANCH
ARG DATE

COPY --from=builder /app/frontend/apps/notify /app/frontend/apps/notify
# COPY --from=builder /app/frontend/apps/notify/node_modules /app/frontend/apps/notify/node_modules
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json

RUN echo "$COMMIT_HASH" > /app/frontend/apps/notify/COMMIT_HASH
RUN echo "$BRANCH" > /app/frontend/apps/notify/BRANCH
RUN echo "$DATE" > /app/frontend/apps/notify/DATE
RUN echo "1" > /app/frontend/apps/notify/IS_BUILD

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 seed-notify
USER seed-notify

EXPOSE 3000

ENV PORT 3000

WORKDIR /app/frontend/apps/notify


CMD ["npm", "run", "start:prod"]