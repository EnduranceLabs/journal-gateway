#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io/journal}"
IMAGE="${REGISTRY}/gateway"
TAG="${TAG:-latest}"

echo "Building Docker image: ${IMAGE}:${TAG}"
docker build -f packaging/docker/Dockerfile -t "${IMAGE}:${TAG}" .

echo "Pushing Docker image: ${IMAGE}:${TAG}"
docker push "${IMAGE}:${TAG}"

echo "Done."
