const fs = require('fs')
const path = require('path')

const metricsDir = path.join(__dirname, '..', 'metrics')

// Get the metrics file to analyze
function getMetricsFile() {
  // Check if a timestamp was provided as an argument
  const timestamp = process.argv[2]
  if (timestamp) {
    const specificFile = `metrics-${timestamp}.log`
    const filePath = path.join(metricsDir, specificFile)
    if (fs.existsSync(filePath)) {
      console.log(`Analyzing metrics from: ${filePath}`)
      return filePath
    } else {
      console.error(`No metrics file found for timestamp: ${timestamp}`)
      process.exit(1)
    }
  }

  // Otherwise, get the most recent metrics file
  const files = fs
    .readdirSync(metricsDir)
    .filter((f) => f.startsWith('metrics-'))
    .sort()
    .reverse()

  if (files.length === 0) {
    console.error('No metrics files found')
    process.exit(1)
  }

  const latestFile = files[0]
  const filePath = path.join(metricsDir, latestFile)
  console.log(`Analyzing most recent metrics from: ${filePath}`)
  return filePath
}

const metricsFile = getMetricsFile()
const content = fs.readFileSync(metricsFile, 'utf8')
const lines = content.split('\n')

// Collect different types of metrics
const stats = {
  initial: {},
  periodic: [],
  performance: [],
  final: null,
}

// Parse the metrics
lines.forEach((line) => {
  try {
    // Skip empty lines
    if (!line.trim()) return

    // Skip non-metrics lines
    if (!line.includes('[STATS-') && !line.includes('[PERF]')) return

    if (line.includes('[STATS-INITIAL]')) {
      const type = line.includes('Memory:')
        ? 'Memory'
        : line.includes('CPU:')
        ? 'CPU'
        : null
      if (!type) return
      const jsonStart = line.indexOf('{')
      if (jsonStart === -1) return
      const data = line.substring(jsonStart)
      try {
        stats.initial[type] = JSON.parse(data)
      } catch (e) {
        console.error('Error parsing initial stats:', e.message)
      }
    } else if (line.includes('[STATS-PERIODIC]')) {
      const type = line.includes('Memory:')
        ? 'Memory'
        : line.includes('CPU:')
        ? 'CPU'
        : null
      if (!type) return
      const jsonStart = line.indexOf('{')
      if (jsonStart === -1) return
      const data = line.substring(jsonStart)
      try {
        const parsedData = JSON.parse(data)
        stats.periodic.push({
          type,
          data: parsedData,
          timestamp: new Date(),
        })
      } catch (e) {
        console.error('Error parsing periodic stats:', e.message)
      }
    } else if (line.includes('[PERF]')) {
      const parts = line.split(': ').slice(1)
      if (parts.length < 2) return
      const name = parts[0]
      const duration = parseFloat(parts[1])
      if (!isNaN(duration)) {
        stats.performance.push({name, duration})
      }
    } else if (line.includes('[STATS-FINAL]')) {
      const parts = line.split(': ')
      if (parts.length < 2) return
      const duration = parseFloat(parts[1])
      if (!isNaN(duration)) {
        stats.final = duration
      }
    }
  } catch (error) {
    // Skip lines that can't be processed
    return
  }
})

// Validate required data
if (
  !stats.initial.Memory ||
  !stats.initial.CPU ||
  stats.periodic.length === 0 ||
  !stats.final
) {
  console.error(
    'Missing required metrics data. The metrics file may be incomplete or corrupted.',
  )
  process.exit(1)
}

// Analysis output
if (stats.performance.length > 0) {
  console.log('\nPerformance Measurements:')
  stats.performance.forEach((p) => {
    console.log(`${p.name}: ${p.duration}ms`)
  })
  console.log()
}

console.log('Initial Stats:')
if (stats.initial.Memory) {
  console.log('Memory:')
  console.log(`  RSS: ${(stats.initial.Memory.rss / 1024 / 1024).toFixed(2)}MB`)
  console.log(
    `  Heap Total: ${(stats.initial.Memory.heapTotal / 1024 / 1024).toFixed(
      2,
    )}MB`,
  )
  console.log(
    `  Heap Used: ${(stats.initial.Memory.heapUsed / 1024 / 1024).toFixed(
      2,
    )}MB`,
  )
  console.log()
}

if (stats.initial.CPU) {
  console.log('CPU:')
  console.log(`  User: ${(stats.initial.CPU.user / 1000).toFixed(2)}ms`)
  console.log(`  System: ${(stats.initial.CPU.system / 1000).toFixed(2)}ms`)
  console.log()
}

function calculateSummary(stats) {
  const memoryStats = stats.periodic.filter((p) => p.type === 'Memory')
  const cpuStats = stats.periodic.filter((p) => p.type === 'CPU')

  // Memory analysis
  const initialRSS = stats.initial.Memory.rss / 1024 / 1024
  const finalRSS = memoryStats[memoryStats.length - 1].data.rss / 1024 / 1024
  const memoryGrowth = finalRSS - initialRSS
  const memoryGrowthRate = (memoryGrowth / (stats.final / 1000)).toFixed(2) // MB/s

  // CPU analysis
  const totalUserTime = cpuStats[cpuStats.length - 1].data.user / 1000
  const totalSystemTime = cpuStats[cpuStats.length - 1].data.system / 1000
  const cpuUsageRate = (
    ((totalUserTime + totalSystemTime) / (stats.final / 1000)) *
    100
  ).toFixed(2) // %

  return {
    memoryGrowth: memoryGrowth.toFixed(2),
    memoryGrowthRate,
    peakRSS: Math.max(...memoryStats.map((m) => m.data.rss)) / 1024 / 1024,
    totalUserTime,
    totalSystemTime,
    cpuUsageRate,
  }
}

// Analysis output
console.log('=== METRICS SUMMARY ===')
const summary = calculateSummary(stats)
console.log(
  `Memory Growth: ${summary.memoryGrowth}MB (${summary.memoryGrowthRate}MB/s)`,
)
console.log(`Peak Memory Usage: ${summary.peakRSS.toFixed(2)}MB`)
console.log(
  `CPU Usage: ${summary.cpuUsageRate}% (User: ${summary.totalUserTime.toFixed(
    2,
  )}ms, System: ${summary.totalSystemTime.toFixed(2)}ms)`,
)
console.log(`Total Runtime: ${(stats.final / 1000).toFixed(2)}s`)
console.log('\n=== DETAILED METRICS ===\n')

// Add trend indicators to memory and CPU outputs
if (stats.periodic.length > 0) {
  console.log('Memory Usage Trends:')
  const memoryStats = stats.periodic.filter((p) => p.type === 'Memory')
  if (memoryStats.length > 0) {
    let prevRSS = memoryStats[0].data.rss
    memoryStats.forEach((p, i) => {
      const timestamp = new Date(Date.now() + i * 1000)
        .toISOString()
        .split('T')[1]
        .split('.')[0]
      const rss = p.data.rss / 1024 / 1024
      const rssDiff = rss - prevRSS / 1024 / 1024
      const trend = rssDiff > 1 ? '↑' : rssDiff < -1 ? '↓' : '→'

      console.log(`[${timestamp}] ${trend}`)
      console.log(
        `  RSS: ${rss.toFixed(2)}MB ${
          rssDiff > 0 ? `(+${rssDiff.toFixed(2)}MB)` : ''
        }`,
      )
      console.log(
        `  Heap Total: ${(p.data.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      )
      console.log(
        `  Heap Used: ${(p.data.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      )
      prevRSS = p.data.rss
    })
    console.log()
  }

  console.log('CPU Usage Trends:')
  const cpuStats = stats.periodic.filter((p) => p.type === 'CPU')
  if (cpuStats.length > 0) {
    let prevTotal = 0
    cpuStats.forEach((p, i) => {
      const timestamp = new Date(Date.now() + i * 1000)
        .toISOString()
        .split('T')[1]
        .split('.')[0]
      const total = (p.data.user + p.data.system) / 1000
      const diff = total - prevTotal
      const trend = diff > 50 ? '↑' : diff < -50 ? '↓' : '→'

      console.log(`[${timestamp}] ${trend}`)
      console.log(`  User: ${(p.data.user / 1000).toFixed(2)}ms`)
      console.log(`  System: ${(p.data.system / 1000).toFixed(2)}ms`)
      console.log(
        `  Total: ${total.toFixed(2)}ms ${
          diff > 0 ? `(+${diff.toFixed(2)}ms)` : ''
        }`,
      )
      prevTotal = total
    })
    console.log()
  }
}

if (stats.final) {
  console.log('Total Runtime:', (stats.final / 1000).toFixed(2), 's')
}

const MEMORY_GROWTH_THRESHOLD = 10 // MB/s
const CPU_USAGE_THRESHOLD = 80 // %
