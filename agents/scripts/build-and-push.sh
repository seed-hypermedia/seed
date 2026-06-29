#!/usr/bin/env bash
#
# Manual build + push of the Agents deployment image, with version metadata baked in.
# Mirrors what the CI docker jobs do (build-args -> Dockerfile ENV -> /api/version).
#
# Usage:
#   agents/scripts/build-and-push.sh [TAG]
#
#   TAG  Image tag to build and push. Defaults to "dev".
#        Use "latest" for the stable image consumed by agents-stable on the host.
#
# Run from anywhere inside the repo; the repo root is used as the build context.
#
# Deploy after pushing: Watchtower on the agent host picks up the new image within
# its poll interval, or force it immediately:
#
#   ssh ubuntu@agentic.seed.hyper.media \
#     'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
#        nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'
#
set -euo pipefail

TAG="${1:-dev}"
IMAGE="seedhypermedia/agents:${TAG}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
COMMIT="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DATE="$(git show -s --format="%cd" HEAD)"

echo "Building ${IMAGE}"
echo "  version=${TAG} commit=${COMMIT} branch=${BRANCH} date=${DATE}"

docker build \
  -t "${IMAGE}" \
  -f "${REPO_ROOT}/agents/Dockerfile" \
  --build-arg "VERSION=${TAG}" \
  --build-arg "COMMIT_HASH=${COMMIT}" \
  --build-arg "BRANCH=${BRANCH}" \
  --build-arg "DATE=${DATE}" \
  "${REPO_ROOT}"

docker push "${IMAGE}"

echo "Pushed ${IMAGE}"
