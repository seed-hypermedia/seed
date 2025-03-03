#!/bin/bash
set -e  # Exit on any error

echo "[UPDATE] Starting macOS update process..."

# Configuration
APP_NAME="SeedDev"  # or "Seed" for production
TEMP_PATH="/tmp/SeedUpdate"
BACKUP_PATH="${TEMP_PATH}/backup"
UNZIP_PATH="${TEMP_PATH}/unzip"
APP_PATH="/Applications/${APP_NAME}.app"
ZIP_FILE="$1"  # First argument should be the path to the ZIP file

# Function to clean up temporary files
cleanup() {
  echo "[UPDATE] Cleaning up..."
  rm -rf "${TEMP_PATH}" || true
  rm -f "${ZIP_FILE}" || true
}

# Function to rollback changes
rollback() {
  echo "[UPDATE] Rolling back changes..."
  if [ -d "${BACKUP_PATH}/${APP_NAME}.app" ]; then
    echo "[UPDATE] Restoring backup..."
    rm -rf "${APP_PATH}" || true
    cp -R "${BACKUP_PATH}/${APP_NAME}.app" "/Applications/"
    echo "[UPDATE] Backup restored successfully"
  else
    echo "[UPDATE] No backup found to restore"
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

# Create temporary directories
mkdir -p "${TEMP_PATH}" "${BACKUP_PATH}" "${UNZIP_PATH}"

# Backup existing app if it exists
if [ -d "${APP_PATH}" ]; then
  echo "[UPDATE] Backing up existing app..."
  cp -R "${APP_PATH}" "${BACKUP_PATH}/"
fi

# Unzip new version
echo "[UPDATE] Unzipping update..."
unzip -o "${ZIP_FILE}" -d "${UNZIP_PATH}"

# Verify the unzipped app exists
if [ ! -d "${UNZIP_PATH}/${APP_NAME}.app" ]; then
  echo "[UPDATE] Error: Unzipped app not found"
  handle_error
fi

# Remove existing app
echo "[UPDATE] Removing existing app..."
rm -rf "${APP_PATH}" || true

# Install new version
echo "[UPDATE] Installing new version..."
cp -R "${UNZIP_PATH}/${APP_NAME}.app" "/Applications/"

# Verify installation
if [ ! -d "${APP_PATH}" ]; then
  echo "[UPDATE] Error: New version not installed correctly"
  handle_error
fi

# Set permissions
echo "[UPDATE] Setting permissions..."
chmod -R u+rwx "${APP_PATH}"

# Clean up
cleanup

echo "[UPDATE] Update completed successfully"

# Start new version
echo "[UPDATE] Starting new version..."
open "${APP_PATH}"