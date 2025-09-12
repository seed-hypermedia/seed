// Debug Auto-Update - Manual Testing Script
// Run this to test specific parts of the auto-update logic

const path = require('path')
const fs = require('fs')

// Mock the Electron app object for testing
const mockApp = {
  getVersion: () => '2025.1.1-dev.1', // Lower version to trigger update
  getPath: (type) => {
    const paths = {
      'temp': '/tmp/seed-update-test',
      'downloads': '/tmp/seed-update-test/downloads'
    }
    return paths[type] || '/tmp/seed-update-test'
  },
  quit: () => console.log('🔄 [MOCK] App would quit here')
}

// Test version comparison logic
function compareVersions(v1, v2) {
  console.log(`🔍 Comparing versions: ${v1} vs ${v2}`)

  // Split version and dev suffix
  const [v1Base, v1Dev] = v1.split('-dev.')
  const [v2Base, v2Dev] = v2.split('-dev.')

  // Compare main version numbers first (2025.2.8)
  const v1Parts = v1Base.split('.').map(Number)
  const v2Parts = v2Base.split('.').map(Number)

  // Compare year.month.patch
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0
    const v2Part = v2Parts[i] || 0
    if (v1Part > v2Part) return 1
    if (v1Part < v2Part) return -1
  }

  // If base versions are equal, compare dev versions
  if (v1Base === v2Base) {
    // If one is dev and other isn't, non-dev is newer
    if (!v1Dev && v2Dev) return 1
    if (v1Dev && !v2Dev) return -1
    // If both are dev versions, compare dev numbers
    if (v1Dev && v2Dev) {
      const v1DevNum = parseInt(v1Dev)
      const v2DevNum = parseInt(v2Dev)
      return v1DevNum - v2DevNum
    }
    return 0
  }

  return 0
}

// Test the version comparison
console.log('🧪 Testing Version Comparison Logic')
console.log('===================================')

const testCases = [
  ['2025.1.1-dev.1', '2025.12.31-dev.999'], // Should update
  ['2025.12.31-dev.999', '2025.1.1-dev.1'], // Should not update
  ['2025.1.1', '2025.1.1-dev.1'],           // Should not update (release > dev)
  ['2025.1.1-dev.1', '2025.1.1'],           // Should update (dev < release)
]

testCases.forEach(([current, latest]) => {
  const result = compareVersions(latest, current)
  const shouldUpdate = result > 0
  console.log(`  ${current} -> ${latest}: ${shouldUpdate ? '✅ UPDATE' : '❌ NO UPDATE'}`)
})

console.log('\n🔍 Testing Update URL Fetch')
console.log('============================')

// Test fetching update info
async function testUpdateCheck(url) {
  try {
    console.log(`📡 Fetching: ${url}`)
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const updateInfo = await response.json()
    console.log('📦 Update Info:')
    console.log(`   Version: ${updateInfo.name}`)
    console.log(`   Release Notes: ${updateInfo.release_notes}`)
    console.log(`   Assets: ${Object.keys(updateInfo.assets || {}).join(', ')}`)
    
    const currentVersion = mockApp.getVersion()
    const shouldUpdate = compareVersions(updateInfo.name, currentVersion) > 0
    console.log(`🎯 Update needed: ${shouldUpdate}`)
    
    return updateInfo
  } catch (error) {
    console.error(`❌ Error: ${error.message}`)
    return null
  }
}

// Test with mock server (if running)
async function runTests() {
  console.log(`📱 Current app version: ${mockApp.getVersion()}`)
  
  // Test local server
  await testUpdateCheck('http://localhost:3001/latest.json')
  
  console.log('\n🧹 Test Complete')
  console.log('================')
  console.log('To test the full flow:')
  console.log('1. Run: ./test-auto-update.sh')
  console.log('2. Start the desktop app with test environment variables')
  console.log('3. Monitor logs for [AUTO-UPDATE] messages')
}

// Only run if this file is executed directly
if (require.main === module) {
  runTests()
}

module.exports = {
  compareVersions,
  testUpdateCheck,
  mockApp
}