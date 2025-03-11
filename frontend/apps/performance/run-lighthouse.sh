#!/bin/bash
# Helper script to run Lighthouse with the Electron app

echo "🚀 Lighthouse Test Helper Script"
echo "=============================="
echo ""
echo "This script will now:"
echo "1. Automatically start your Electron app"
echo "2. Run Lighthouse tests against it"
echo "3. Clean up when complete"
echo ""

# Run Lighthouse with automatic app launching
yarn test --lighthouse 