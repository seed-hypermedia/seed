#!/bin/bash
set -e  # Exit on any error

echo "[UPDATE] Starting Linux update process..."

# Configuration
PACKAGE_NAME="seed-dev"  # or "seed" for production
TEMP_PATH="/tmp/SeedUpdate"
BACKUP_PATH="${TEMP_PATH}/backup"
PACKAGE_FILE="$1"  # First argument should be the path to the DEB/RPM file

# Detect package type
if [[ "${PACKAGE_FILE}" == *.rpm ]]; then
  IS_RPM=true
  REMOVE_CMD="rpm -e"
  INSTALL_CMD="rpm -U"
  QUERY_CMD="rpm -q"
else
  IS_RPM=false
  REMOVE_CMD="dpkg -r"
  INSTALL_CMD="dpkg -i"
  QUERY_CMD="dpkg -l"
fi

# Function to clean up temporary files
cleanup() {
  echo "[UPDATE] Cleaning up..."
  rm -rf "${TEMP_PATH}" || true
  rm -f "${PACKAGE_FILE}" || true
}

# Function to save current version
save_current_version() {
  echo "[UPDATE] Saving current version info..."
  mkdir -p "${BACKUP_PATH}"
  if ${QUERY_CMD} ${PACKAGE_NAME} > /dev/null 2>&1; then
    ${QUERY_CMD} ${PACKAGE_NAME} | grep ${PACKAGE_NAME} > "${BACKUP_PATH}/version.txt"
    echo "[UPDATE] Current version saved"
  else
    echo "[UPDATE] No previous version found"
  fi
}

# Function to rollback changes
rollback() {
  echo "[UPDATE] Rolling back changes..."
  if [ -f "${BACKUP_PATH}/version.txt" ]; then
    echo "[UPDATE] Restoring previous version..."
    
    # Remove failed new version
    pkexec ${REMOVE_CMD} ${PACKAGE_NAME} || true
    
    if [ "$IS_RPM" = false ]; then
      # For DEB packages, we need to force old version installation
      OLD_VERSION=$(awk '{print $3}' "${BACKUP_PATH}/version.txt")
      if [ -n "$OLD_VERSION" ]; then
        echo "[UPDATE] Rolling back to version ${OLD_VERSION}"
        pkexec apt-get install ${PACKAGE_NAME}=${OLD_VERSION} -y
      fi
    fi
    echo "[UPDATE] Rollback completed"
  else
    echo "[UPDATE] No backup version found to restore"
  fi
}

# Error handler
handle_error() {
  echo "[UPDATE] Error occurred during update process"
  rollback
  cleanup
  exit 1
}

# Set up error handling
trap 'handle_error' ERR

# Verify arguments
if [ -z "$PACKAGE_FILE" ]; then
  echo "Usage: $0 <path-to-package-file>"
  exit 1
fi

if [ ! -f "$PACKAGE_FILE" ]; then
  echo "Error: Package file not found: $PACKAGE_FILE"
  exit 1
fi

# Create temp directory
mkdir -p "${TEMP_PATH}"

# Save current version for potential rollback
save_current_version

# Remove existing package
echo "[UPDATE] Removing existing package..."
pkexec ${REMOVE_CMD} ${PACKAGE_NAME} || true

# Install new package
echo "[UPDATE] Installing new package..."
pkexec ${INSTALL_CMD} "${PACKAGE_FILE}"

# Verify installation
echo "[UPDATE] Verifying installation..."
if ! ${QUERY_CMD} ${PACKAGE_NAME} | grep ${PACKAGE_NAME}; then
  echo "[UPDATE] Error: Package verification failed"
  handle_error
fi

# Clean up
cleanup

echo "[UPDATE] Update completed successfully"

# Start new version
echo "[UPDATE] Starting new version..."
nohup ${PACKAGE_NAME} > /dev/null 2>&1 &

echo "[UPDATE] Process completed"