# Build from the root with `docker build -t monitord . -f ./backend/cmd/monitord/Dockerfile`.
FROM golang:1.27.1-alpine AS builder
WORKDIR /code
COPY go.mod go.sum ./
COPY backend/util/llama-go/go.mod backend/util/llama-go/go.sum ./backend/util/llama-go/
# The module proxy occasionally drops a download mid-stream (proxy.golang.org INTERNAL_ERROR);
# retry so one flaky connection does not fail the whole image build.
RUN for attempt in 1 2 3; do go mod download && exit 0; echo "go mod download failed (attempt $attempt), retrying"; sleep 10; done; exit 1
COPY backend ./backend
RUN apk add build-base
RUN go install ./backend/cmd/monitord/

FROM alpine:latest
COPY --from=builder /go/bin/monitord /usr/local/bin/monitord
COPY --from=builder /code/backend/cmd/monitord/template.html /template.html
EXPOSE 5002
CMD ["/usr/local/bin/monitord"]
