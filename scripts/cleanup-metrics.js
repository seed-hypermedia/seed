#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Path to the metrics directory relative to this script
const metricsDir = path.join(
  __dirname,
  '..',
  'frontend',
  'apps',
  'desktop',
  'metrics',
)

function cleanupMetrics() {
  console.log('Cleaning up metrics files...')

  if (!fs.existsSync(metricsDir)) {
    console.log('No metrics directory found. Nothing to clean.')
    return
  }

  try {
    const files = fs.readdirSync(metricsDir)
    let count = 0

    for (const file of files) {
      if (file.startsWith('metrics-') || file.startsWith('results-')) {
        fs.unlinkSync(path.join(metricsDir, file))
        count++
      }
    }

    console.log(`Cleaned up ${count} metrics files.`)
  } catch (error) {
    console.error('Error cleaning up metrics files:', error)
    process.exit(1)
  }
}

cleanupMetrics()
