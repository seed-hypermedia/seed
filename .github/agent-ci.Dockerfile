FROM ghcr.io/actions/actions-runner:latest

# Pre-create /home/runner/.cache with runner ownership.
# agent-ci bind-mounts /home/runner/.cache/ms-playwright on top, which would
# otherwise cause Docker to create /home/runner/.cache as root, blocking
# tools like golangci-lint that write sibling dirs (.cache/golangci-lint).
RUN sudo install -d -o runner -g runner -m 0755 /home/runner/.cache /home/runner/.cache/golangci-lint
