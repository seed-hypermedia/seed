# Build from the root with `docker build -t seed-web . -f ./frontend/apps/site/Dockerfile`.
# docker run -e ENV_EXAMPLE=yes-it -p 3000:3000 --rm --name seed-web seed-web:latest

FROM node:20-alpine AS builder

RUN apk add git
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .

ENV NODE_ENV production

RUN yarn install  --frozen-lockfile
RUN yarn web:prod

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 seed-web
USER seed-web

EXPOSE 3000

ENV PORT 3000

WORKDIR /app/frontend/apps/web
CMD ["npm", "start"]