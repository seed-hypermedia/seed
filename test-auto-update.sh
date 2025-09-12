#!/bin/bash

# Test Auto-Update Script
# This script helps test the auto-update functionality without building full versions

echo "🧪 Auto-Update Test Script"
echo "=========================="

# Check if node is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not found"
    exit 1
fi

# Start the mock update server in background
echo "🚀 Starting mock update server..."
node test-update-server.js &
SERVER_PID=$!

# Give the server time to start
sleep 2

echo "📱 Mock server running at http://localhost:3001"
echo "   Update endpoint: http://localhost:3001/latest.json"
echo ""

# Function to cleanup
cleanup() {
    echo "🧹 Cleaning up..."
    kill $SERVER_PID 2>/dev/null || true
    exit 0
}

# Trap cleanup function
trap cleanup SIGINT SIGTERM

echo "🎯 Test Options:"
echo "1. Full test mode (downloads but skips installation)"
echo "2. Check-only mode (just checks for updates)"
echo ""

read -p "Choose test mode (1 or 2): " choice

case $choice in
    1)
        echo "🔄 Running full test mode..."
        export AUTO_UPDATE_TEST_URL="http://localhost:3001/latest.json"
        export AUTO_UPDATE_TEST_MODE="true"
        echo "Environment variables set:"
        echo "  AUTO_UPDATE_TEST_URL=$AUTO_UPDATE_TEST_URL"
        echo "  AUTO_UPDATE_TEST_MODE=$AUTO_UPDATE_TEST_MODE"
        ;;
    2)
        echo "🔍 Running check-only mode..."
        export AUTO_UPDATE_TEST_URL="http://localhost:3001/latest.json"
        echo "Environment variables set:"
        echo "  AUTO_UPDATE_TEST_URL=$AUTO_UPDATE_TEST_URL"
        ;;
    *)
        echo "❌ Invalid choice"
        cleanup
        ;;
esac

echo ""
echo "📋 Instructions:"
echo "1. The mock server is now running"
echo "2. Start your desktop app with the environment variables set"
echo "3. The app will use the test update URL"
echo "4. Check the app logs and the mock server output"
echo "5. Press Ctrl+C when done to stop the server"
echo ""
echo "🔍 To manually trigger update check, use the app's update menu or wait for automatic check"
echo ""
echo "📊 Logs to watch:"
echo "- Desktop app logs (check console for [AUTO-UPDATE] messages)"
echo "- This terminal (mock server requests)"
echo ""

# Keep the script running
wait $SERVER_PID