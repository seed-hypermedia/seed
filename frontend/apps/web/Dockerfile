# Build from the root with `docker build -t seedhypermedia/web:dev . -f ./frontend/apps/web/Dockerfile`.
# Push to the server with `docker save seedhypermedia/web:dev | ssh -C <user>@<server_IP> docker load`
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-web seed-web:latest

FROM node:20-alpine AS builder
RUN apk add --no-cache git libc6-compat
WORKDIR /app
COPY package.json yarn.lock ./
COPY frontend/apps/web/package.json frontend/apps/web/
RUN yarn install --frozen-lockfile
COPY . .
RUN rm -rf ./frontend/apps/desktop \
    ./frontend/apps/performance \
    ./frontend/apps/perf-web \
    ./frontend/apps/performance-dashboard \
    ./frontend/apps/explore
ENV NODE_ENV=production
RUN yarn web:prod

FROM node:20-alpine AS production
ARG COMMIT_HASH
ARG BRANCH
ARG DATE
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 seed-web
WORKDIR /app/frontend/apps/web
COPY --from=builder /app/frontend/apps/web ./
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
RUN echo "$COMMIT_HASH" > COMMIT_HASH && echo "$BRANCH" > BRANCH && echo "$DATE" > DATE && echo "1" > IS_BUILD
USER seed-web
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "run", "start:prod"]
