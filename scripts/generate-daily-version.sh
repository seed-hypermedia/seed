#!/bin/bash

git fetch --tags origin

# Extract version number from the branch name
VERSION=$(date +"%Y.%-m")

# Check if there are any releases matching the branch's version pattern
RELEASES=$(git tag --list "$VERSION.*" | sort -V)

if [ -z "$RELEASES" ]; then
  # If no releases are found, set the version to <branch_version>-rc0
  VERSION="$VERSION.0"
else
  # If there are releases, find the latest release and increment the version
  LATEST_RELEASE=$(echo "$RELEASES" | tail -n 1)
  NEXT_NUMBER=$(echo "$LATEST_RELEASE" | grep -oP '\d+$' | awk '{print $1 + 1}')
  VERSION="$VERSION.$NEXT_NUMBER"
fi

echo $VERSION
