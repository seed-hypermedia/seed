# Build from the root with `docker build . -f ./backend/cmd/seed-daemon/Dockerfile`.

# Use Debian Trixie for glibc compatibility and newer Vulkan SDK (1.4.309+).
# Alpine's musl libc is incompatible with GCC 14's libstdc++ which uses
# glibc-specific symbols (__libc_single_threaded, __isoc23_* functions).
# Bookworm's Vulkan SDK (1.3.239) is too old for llama.cpp's ggml-vulkan.
FROM golang:1.25-trixie AS builder
WORKDIR /code
ARG COMMIT_HASH
ARG BRANCH
ARG DATE
COPY go.mod go.sum ./
COPY backend/util/llama-go/go.mod backend/util/llama-go/go.sum ./backend/util/llama-go/
RUN go mod download
COPY backend ./backend
COPY monitoring ./monitoring

# Install build dependencies for llama.cpp with Vulkan GPU support.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake g++ libvulkan-dev glslc \
    && rm -rf /var/lib/apt/lists/*

# Build llama.cpp with Vulkan GPU support (falls back to CPU at runtime if no GPU available).
# Clean any pre-existing build artifacts copied from host to ensure fresh build.
WORKDIR /code/backend/util/llama-go
RUN rm -rf build llama.cpp/*.o *.o *.a *.so && \
    BUILD_TYPE=vulkan CMAKE_ARGS="-DBUILD_SHARED_LIBS=OFF" make libbinding.a

# Build seed-daemon with llama.cpp support.
WORKDIR /code
ENV LIBRARY_PATH=/code/backend/util/llama-go
ENV C_INCLUDE_PATH=/code/backend/util/llama-go
RUN go install -ldflags="-X 'seed/backend/daemon.commit=$COMMIT_HASH' -X 'seed/backend/daemon.branch=$BRANCH' -X 'seed/backend/daemon.date=$DATE'" ./backend/cmd/seed-daemon/

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    rsync libvulkan1 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /go/bin/seed-daemon /usr/local/bin/seed-daemon
COPY --from=builder /code/monitoring/grafana /monitoring/grafana
COPY --from=builder /code/monitoring/prometheus /monitoring/prometheus
EXPOSE 55000 55001 55002
ENV SEED_PUBLIC_ONLY=true
ENV LLAMA_LOG=error
CMD ["/usr/local/bin/seed-daemon"]
