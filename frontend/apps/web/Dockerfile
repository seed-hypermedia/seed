# Build from the root with `docker build -t seedhypermedia/web:dev . -f ./frontend/apps/web/Dockerfile`.
# Push to the server with `docker save seedhypermedia/web:dev | ssh -C <user>@<server_IP> docker load`
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-web seed-web:latest

FROM node:20-alpine AS builder

RUN apk add git
RUN npm install -g pnpm
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .


ENV NODE_ENV production
RUN rm -rf ./frontend/apps/desktop
RUN rm -rf ./frontend/apps/performance
RUN rm -rf ./frontend/apps/perf-web
RUN rm -rf ./frontend/apps/performance-dashboard
RUN rm -rf ./frontend/apps/explore
RUN pnpm install --frozen-lockfile
RUN pnpm web:prod

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

ENV PORT 3000

WORKDIR /app/frontend/apps/web


CMD ["npm", "run", "start:prod"]