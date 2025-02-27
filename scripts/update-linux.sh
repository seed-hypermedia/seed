#!/bin/bash
set -e  # Exit on any error

echo "[UPDATE] Starting Linux update process..."

sleep 2

echo "[UPDATE] Removing existing package..."
# Remove existing package with error handling
if command -v pkexec > /dev/null; then
if ! pkexec dpkg -r seed-dev; then
	echo "[UPDATE] Warning: Failed to remove old package, continuing anyway..."
fi
else
echo "[UPDATE] Error: pkexec not found, trying with sudo..."
if ! sudo dpkg -r seed-dev; then
	echo "[UPDATE] Warning: Failed to remove old package, continuing anyway..."
fi
fi

echo "[UPDATE] Installing new package..."
# Install new package
if command -v pkexec > /dev/null; then

if ! sudo dpkg -i /home/cooler/Downloads/seed-dev_2025.2.9-dev.12_amd64.deb; then
	echo "[UPDATE] Error: Failed to install new package"
	exit 1
fi
fi

echo "[UPDATE] Verifying installation..."
# Verify the installation
if ! command -v seed-dev > /dev/null; then
echo "[UPDATE] Error: New version not properly installed"
dpkg -l seed-dev || rpm -q seed-dev || true
exit 1
fi

echo "[UPDATE] Cleaning up..."
# Clean up
# rm -rf "${tempPath}"
# rm -f "${filePath}"

echo "[UPDATE] Starting new version..."
# Start the new version using nohup to keep it running
( nohup seed-dev > /dev/null 2>&1 & )

echo "[UPDATE] Update completed successfully"