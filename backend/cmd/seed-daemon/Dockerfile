# Build from the root with `docker build . -f ./backend/cmd/seed-daemon/Dockerfile`.
FROM golang:1.24.5-alpine AS builder
WORKDIR /code
ARG COMMIT_HASH
ARG BRANCH
ARG DATE
COPY go.mod go.sum ./
RUN go mod download
COPY backend ./backend
COPY monitoring ./monitoring
RUN apk add build-base
RUN go install -ldflags="-X 'seed/backend/daemon.commit=$COMMIT_HASH' -X 'seed/backend/daemon.branch=$BRANCH' -X 'seed/backend/daemon.date=$DATE'" ./backend/cmd/seed-daemon/

FROM alpine:latest
RUN apk add rsync
COPY --from=builder /go/bin/seed-daemon /usr/local/bin/seed-daemon
COPY --from=builder /code/monitoring/grafana /monitoring/grafana
COPY --from=builder /code/monitoring/prometheus /monitoring/prometheus
EXPOSE 55000 55001 55002
CMD ["/usr/local/bin/seed-daemon"]
