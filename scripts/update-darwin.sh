#!/bin/bash
set -e  # Exit on any error

echo "[UPDATE] Starting macOS update process..."

# Wait for any file operations to complete
sleep 2

# Check if the DMG is properly mounted and find the actual mount point
MOUNT_POINT=$(hdiutil info | grep "/Volumes/SeedDev" | awk '{print $1}')
if [ -z "$MOUNT_POINT" ]; then
echo "[UPDATE] Error: DMG not properly mounted"
exit 1
fi

# Check if the new app exists in the DMG
if [ ! -d "/Volumes/SeedDev" ]; then
echo "[UPDATE] Error: New app not found in DMG at /Volumes/SeedDev"
ls -la "/Volumes/SeedDev" || true
exit 1
fi

echo "[UPDATE] Removing existing app..."
# Remove existing app (with sudo if needed)
if [ -d "/Applications/SeedDev.app" ]; then
rm -rf "/Applications/SeedDev.app" || sudo rm -rf "/Applications/SeedDev.app"
fi

echo "[UPDATE] Installing new version..."
# Copy new app from mounted DMG to Applications
cp -R "/Volumes/SeedDev/SeedDev.app" "/Applications/" || sudo cp -R "/Volumes/SeedDev/SeedDev.app" "/Applications/"

# Verify the copy was successful
if [ ! -d "/Applications/SeedDev.app" ]; then
echo "[UPDATE] Error: Failed to copy new app to Applications"
exit 1
fi

echo "[UPDATE] Setting permissions..."
# Ensure proper permissions
chmod -R u+rwx "/Applications/SeedDev.app" || sudo chmod -R u+rwx "/Applications/SeedDev.app"

echo "[UPDATE] Cleaning up..."
echo "$MOUNT_POINT"

# Unmount the DMG
hdiutil detach "$MOUNT_POINT" -force || true

# Clean up
# rm -rf "${tempPath}"
# rm -f "${filePath}"

echo "[UPDATE] Starting new version..."
# Open the new app
open "/Applications/SeedDev.app"