# Build from the root with `docker build -t seed-web . -f ./frontend/apps/web/Dockerfile`.
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-web seed-web:latest

FROM node:20-alpine AS builder

RUN apk add git
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .

ENV NODE_ENV production
RUN rm -rf ./frontend/apps/desktop
RUN yarn install
RUN yarn web:prod

FROM node:20-alpine AS production

COPY --from=builder /app/frontend/apps/web /app/frontend/apps/web
# COPY --from=builder /app/frontend/apps/web/node_modules /app/frontend/apps/web/node_modules
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 seed-web
USER seed-web

EXPOSE 3000

ENV PORT 3000

WORKDIR /app/frontend/apps/web
CMD ["npm", "start"]