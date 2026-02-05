# Build from the root with `docker build . -f ./backend/cmd/seed-daemon/Dockerfile`.


FROM golang:1.25.4-alpine AS builder
WORKDIR /code
ARG COMMIT_HASH
ARG BRANCH
ARG DATE
COPY go.mod go.sum ./
RUN go mod download
COPY backend ./backend
COPY monitoring ./monitoring

# Install build dependencies for llama.cpp (CPU-only build for server)
RUN apk add build-base cmake g++ linux-headers vulkan-headers vulkan-loader-dev shaderc

# Build llama.cpp with CPU-only support (no GPU for server environments)
WORKDIR /code/backend/util/llama-go
RUN CMAKE_ARGS="-DBUILD_SHARED_LIBS=OFF" make libbinding.a

# Build seed-daemon with llama.cpp support
WORKDIR /code
ENV LIBRARY_PATH=/code/backend/util/llama-go
ENV C_INCLUDE_PATH=/code/backend/util/llama-go
RUN go install -ldflags="-X 'seed/backend/daemon.commit=$COMMIT_HASH' -X 'seed/backend/daemon.branch=$BRANCH' -X 'seed/backend/daemon.date=$DATE'" ./backend/cmd/seed-daemon/

FROM alpine:latest
RUN apk add rsync
COPY --from=builder /go/bin/seed-daemon /usr/local/bin/seed-daemon
COPY --from=builder /code/monitoring/grafana /monitoring/grafana
COPY --from=builder /code/monitoring/prometheus /monitoring/prometheus
EXPOSE 55000 55001 55002
ENV SEED_PUBLIC_ONLY=true
ENV LLAMA_LOG=error
CMD ["/usr/local/bin/seed-daemon"]
